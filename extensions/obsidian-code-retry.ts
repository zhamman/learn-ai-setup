import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

type LessonLogSession = { subjectDir?: string | null };

function latestLessonState(ctx: any): LessonLogSession | null {
	let last: LessonLogSession | null = null;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type === "custom" && entry.customType === "lesson-log") last = entry.data as LessonLogSession;
	}
	return last;
}

export default function obsidianCodeRetry(pi: ExtensionAPI) {
	pi.on("tool_result", async (event: any, ctx: any) => {
		if (event.toolName !== "lesson_code_result") return;
		if (event.details?.status !== "incorrect") return;
		const exerciseId = String(event.details?.exerciseId || event.details?.assessmentId || "");
		const subjectDir = latestLessonState(ctx)?.subjectDir;
		if (!exerciseId || !subjectDir) return;

		const file = path.join(subjectDir, ".learning", "assessments", `${exerciseId}.json`);
		if (!fs.existsSync(file)) return;
		try {
			const assessment = JSON.parse(fs.readFileSync(file, "utf-8"));
			if (assessment?.type !== "code") return;
			assessment.status = "pending";
			const temp = `${file}.tmp`;
			fs.writeFileSync(temp, `${JSON.stringify(assessment, null, 2)}\n`, "utf-8");
			fs.renameSync(temp, file);
		} catch {
			// Leave the original assessment untouched if its hidden state is malformed.
		}
	});
}
