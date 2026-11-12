import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import marketplaceRouter from "./marketplace";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(marketplaceRouter);

export default router;
