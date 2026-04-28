import { spawn } from "child_process";
import type { Request, Response } from "express";
import { Readable } from "stream";

/* -------------------- CONFIG -------------------- */
const CACHE_TTL = 1000 * 60 * 30; // 30 min
const MAX_CACHE_SIZE = 100;

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 20;

const ALLOWED_ORIGIN = "*";

/* -------------------- CACHE -------------------- */
type CacheEntry = {
	audioUrl: string;
	title: string;
	duration: number;
	ext: string;
	timestamp: number;
};

const cache = new Map<string, CacheEntry>();

/* -------------------- RATE LIMIT -------------------- */
const ipHits = new Map<string, { count: number; start: number }>();

function rateLimit(ip: string): boolean {
	const now = Date.now();
	const entry = ipHits.get(ip);

	if (!entry) {
		ipHits.set(ip, { count: 1, start: now });
		return true;
	}

	if (now - entry.start > RATE_LIMIT_WINDOW) {
		ipHits.set(ip, { count: 1, start: now });
		return true;
	}

	if (entry.count >= RATE_LIMIT_MAX) return false;

	entry.count++;
	return true;
}

/* -------------------- YT-DLP -------------------- */
function runYtDlp(url: string): Promise<any> {
	return new Promise((resolve, reject) => {
		const proc = spawn("yt-dlp", ["-j", "-f", "bestaudio", url]);

		let data = "";
		let error = "";

		proc.stdout.on("data", (c) => (data += c.toString()));
		proc.stderr.on("data", (c) => (error += c.toString()));

		proc.on("close", (code) => {
			if (code !== 0)
				return reject(new Error(error || "yt-dlp failed"));
			try {
				resolve(JSON.parse(data));
			} catch (e) {
				reject(e);
			}
		});

		proc.on("error", reject);
	});
}

/* -------------------- VALIDATION -------------------- */
function isValidVideoId(id: string) {
	return /^[a-zA-Z0-9_-]{11}$/.test(id);
}

/* -------------------- CONTROLLER -------------------- */
export async function getAudio(req: Request, res: Response) {
	try {
		const ip =
			req.headers["x-forwarded-for"]?.toString().split(",")[0] ||
			req.socket.remoteAddress ||
			"unknown";

		if (!rateLimit(ip)) {
			return res.status(429).json({ error: "Too many requests" });
		}

		const videoId = req.params.id as string;

		if (!videoId || !isValidVideoId(videoId)) {
			return res.status(400).json({ error: "Invalid or missing id" });
		}

		const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

		let data = cache.get(videoId);

		if (data && Date.now() - data.timestamp > CACHE_TTL) {
			cache.delete(videoId);
			data = undefined;
		}

		if (!data) {
			const info = await runYtDlp(ytUrl);

			data = {
				audioUrl: info.url,
				title: info.title || "Unknown",
				duration: info.duration || 0,
				ext: info.ext || "webm",
				timestamp: Date.now(),
			};

			// enforce cache limit
			if (cache.size >= MAX_CACHE_SIZE) {
				const iterator = cache.keys().next();
				if (!iterator.done) {
					cache.delete(iterator.value);
				}
			}

			cache.set(videoId, data);
		}

		const range = req.headers.range;

		const upstream = await fetch(data.audioUrl, {
			headers: range ? { Range: range } : {},
		});

		if (!upstream.ok || !upstream.body) {
			return res
				.status(upstream.status)
				.json({ error: "Upstream failed" });
		}

		/* ---------------- STREAM RESPONSE ---------------- */
		res.setHeader(
			"Content-Type",
			data.ext === "m4a" ? "audio/mp4" : "audio/webm",
		);

		res.setHeader("Cache-Control", "no-store");
		res.setHeader("Accept-Ranges", "bytes");

		res.setHeader("X-Title", encodeURIComponent(data.title));
		res.setHeader("X-Duration", String(data.duration));

		res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
		res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
		res.setHeader(
			"Access-Control-Expose-Headers",
			"X-Title, X-Duration",
		);

		// IMPORTANT: stream body
		const nodeStream = Readable.fromWeb(upstream.body as any);
		nodeStream.pipe(res);
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: "Internal server error" });
	}
}

/* -------------------- OPTIONS -------------------- */
export function audioOptions(_req: Request, res: Response) {
	res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "*");
	res.sendStatus(204);
}


/*
export async function getAudio(req: Request, res: Response) {
	// 1. SET CORS HEADERS IMMEDIATELY
	res.setHeader("Access-Control-Allow-Origin", "*"); // Allow all origins
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization",
	);
	res.setHeader(
		"Access-Control-Expose-Headers",
		"X-Title, X-Duration",
	);

	// 2. Handle the "Preflight" check
	if (req.method === "OPTIONS") {
		return res.sendStatus(204);
	}
	try {
		const id = req.params.id as string;
		if (!id || !isValidVideoId(id)) {
			return res.status(400).json({ error: "Invalid ID" });
		}
		let data: any;
		// Use the queue to run yt-dlp metadata extraction
		data = await queue.run(async () => {
			return new Promise((resolve, reject) => {
				// -j: Get JSON metadata
				// -g: Get the direct URL only
				const proc = spawn("yt-dlp", [
					"-j",
					"-f",
					"bestaudio",
					`https://www.youtube.com/watch?v=${id}`,
				]);

				let output = "";
				proc.stdout.on("data", (chunk) => (output += chunk));
				proc.on("close", (code) => {
					if (code !== 0) reject("yt-dlp failed");
					try {
						resolve(JSON.parse(output));
					} catch (e) {
						reject(e);
					}
				});
			});
		});

		// Send the JSON "Receipt"
		return res.json({
			title: data.title,
			duration: data.duration,
			audioUrl: data.url, // This is the direct Google/YouTube CDN link
			thumbnail: data.thumbnail,
		});
	} catch (err) {
		res.status(500).json({ error: "Failed to fetch metadata" });
	}
}

*/