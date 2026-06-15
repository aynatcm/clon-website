import { createProjectAndRedirect } from "@/actions/projects";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, Textarea, Button } from "@/components/ui";

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New analysis</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Phase 1 — provide a URL (required) plus any optional sources. Everything is stored and merged. The crawler is
          the primary source; uploads and pasted CSS/HTML are fallbacks.
        </p>
      </div>

      <form action={createProjectAndRedirect}>
        <Card>
          <CardHeader>
            <CardTitle>Source</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Project name</Label>
              <Input id="name" name="name" placeholder="Acme website" required />
            </div>
            <div>
              <Label htmlFor="url">Website URL (required)</Label>
              <Input id="url" name="url" placeholder="https://linear.app" required />
            </div>
            <div>
              <Label htmlFor="files">Screenshots / assets (optional)</Label>
              <Input id="files" name="files" type="file" multiple accept="image/*" />
            </div>
            <div>
              <Label htmlFor="css">Paste CSS (optional)</Label>
              <Textarea id="css" name="css" rows={4} placeholder=":root { --brand: #4f46e5 } ..." />
            </div>
            <div>
              <Label htmlFor="html">Paste HTML (optional)</Label>
              <Textarea id="html" name="html" rows={4} placeholder="<section class='hero'>...</section>" />
            </div>
            <div>
              <Label htmlFor="brandNotes">Brand guidelines / design references (optional)</Label>
              <Textarea
                id="brandNotes"
                name="brandNotes"
                rows={3}
                placeholder="Tone: confident, technical. Avoid playful illustrations. Prefer dense data UIs..."
              />
            </div>
            <Button type="submit" size="lg" className="w-full">
              Create project →
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
