import { Router, type IRouter } from "express";
import authRouter from "./auth";
import cogsRouter from "./cogs";
import healthRouter from "./health";
import marketplaceRouter from "./marketplace";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(marketplaceRouter);
router.use(cogsRouter);

export default router;
