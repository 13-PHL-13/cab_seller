import tls from "node:tls";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to send account emails`);
  return value;
}

async function sendMail(email: string, subjectText: string, paragraphs: string[]): Promise<void> {
  const host = required("SMTP_HOST");
  const port = Number(process.env.SMTP_PORT ?? 465);
  if (port !== 465) throw new Error("SMTP transport requires implicit TLS on port 465.");
  const user = required("SMTP_USER");
  const password = required("SMTP_PASSWORD");
  const from = required("SMTP_FROM");

  const socket = tls.connect({ host, port, servername: host });
  socket.setTimeout(15_000, () => socket.destroy(new Error("SMTP connection timed out.")));
  socket.setEncoding("utf8");
  let buffer = "";
  let pendingReply = "";
  const waiters: Array<(reply: string) => void> = [];
  const replies: string[] = [];
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\r\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      pendingReply += line + "\n";
      if (/^\d{3} /.test(line)) {
        const waiter = waiters.shift();
        if (waiter) waiter(pendingReply);
        else replies.push(pendingReply);
        pendingReply = "";
      }
    }
  });
  const read = () => new Promise<string>((resolve, reject) => {
    const queued = replies.shift();
    if (queued) return resolve(queued);
    waiters.push(resolve);
    socket.once("error", reject);
  });
  const command = async (value: string, expected: number) => {
    socket.write(value + "\r\n");
    const reply = await read();
    if (!reply.startsWith(String(expected))) throw new Error("SMTP server rejected an email command.");
  };

  try {
    const greeting = await read();
    if (!greeting.startsWith("220")) throw new Error("SMTP server greeting failed.");
    await command("EHLO navigator-sales.local", 250);
    await command(`AUTH PLAIN ${Buffer.from(`\0${user}\0${password}`).toString("base64")}`, 235);
    await command(`MAIL FROM:<${from}>`, 250);
    await command(`RCPT TO:<${email}>`, 250);
    await command("DATA", 354);
    const subject = "=?UTF-8?B?" + Buffer.from(subjectText).toString("base64") + "?=";
    const body = [
      `From: ${from}`, `To: ${email}`, `Subject: ${subject}`,
      "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: 8bit", "", ...paragraphs, ".", "",
    ].join("\r\n").replace(/^\./gm, "..");
    socket.write(body);
    const accepted = await read();
    if (!accepted.startsWith("250")) throw new Error("SMTP server did not accept the email.");
    socket.write("QUIT\r\n");
    await read().catch(() => "");
  } finally {
    socket.end();
  }
}

export async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const origin = required("APP_ORIGIN").replace(/\/$/, "");
  const link = `${origin}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail(email, "Подтверждение регистрации — Навигатор продаж", [
    "Здравствуйте!", "Чтобы подтвердить адрес электронной почты, откройте ссылку:", link,
    "", "Ссылка действует 30 минут.", "Если вы не регистрировались, проигнорируйте это письмо.",
  ]);
}

export async function sendPasswordResetEmail(email: string, token: string): Promise<void> {
  const origin = required("APP_ORIGIN").replace(/\/$/, "");
  const link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
  await sendMail(email, "Сброс пароля — Навигатор продаж", [
    "Здравствуйте!", "Чтобы задать новый пароль, откройте ссылку:", link,
    "", "Ссылка действует 30 минут. Если вы не запрашивали сброс, проигнорируйте это письмо.",
  ]);
}
