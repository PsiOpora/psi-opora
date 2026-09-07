import { spawn } from "node:child_process";

/**
 * Перекодирует голосовое в OGG/OPUS через системный `ffmpeg` (см. apps/clients/
 * Dockerfile). Нужен, чтобы Telegram sendVoice показывал нативный
 * плеер-волну — он ожидает именно OGG/OPUS, а браузерный MediaRecorder
 * (apps/clients/components/messaging/message-composer.tsx) в Chrome/Safari
 * умеет писать только WebM/Opus; без перекодирования голосовое доходит до
 * клиента обычным файлом-вложением.
 */
export async function transcodeToOggOpus(
	bytes: Uint8Array,
): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const ffmpeg = spawn("ffmpeg", [
			"-hide_banner",
			"-loglevel",
			"error",
			"-i",
			"pipe:0",
			"-vn",
			"-c:a",
			"libopus",
			"-b:a",
			"32k",
			"-ac",
			"1",
			"-f",
			"ogg",
			"pipe:1",
		]);

		const chunks: Buffer[] = [];
		let stderr = "";
		ffmpeg.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		ffmpeg.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		ffmpeg.on("error", reject);
		ffmpeg.on("close", (code) => {
			if (code === 0) {
				resolve(new Uint8Array(Buffer.concat(chunks)));
			} else {
				reject(new Error(`ffmpeg завершился с кодом ${code}: ${stderr}`));
			}
		});

		ffmpeg.stdin.write(bytes);
		ffmpeg.stdin.end();
	});
}
