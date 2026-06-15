import { inngest } from "./client";
import { runAnalysis } from "@/lib/pipeline";

/**
 * Durable analysis pipeline. Inngest gives retries + observability; the actual
 * orchestration lives in runAnalysis so it can also run inline (server action).
 */
export const analyzeProject = inngest.createFunction(
  {
    id: "analyze-project",
    name: "Analyze project & extract Design DNA",
    retries: 1,
    triggers: [{ event: "project/analyze" }],
  },
  async ({ event, step }) => {
    const projectId = event.data.projectId as string;
    await step.run("run-analysis", async () => {
      await runAnalysis(projectId);
      return { projectId };
    });
    return { projectId, status: "READY" };
  },
);

export const functions = [analyzeProject];
