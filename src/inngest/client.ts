import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "design-dna-platform" });

export type AnalyzeEvent = {
  data: { projectId: string };
};
