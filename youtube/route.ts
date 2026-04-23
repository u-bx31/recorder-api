import { spawn } from "child_process";

export const runtime = "nodejs";

/* -------------------- CONFIG -------------------- */
const CACHE_TTL = 1000 * 60 * 30; // 30 min
const MAX_CACHE_SIZE = 100;

const RATE_LIMIT_WINDOW = 60 * 1000; // 1 min
const RATE_LIMIT_MAX = 20; // requests per window

const ALLOWED_ORIGIN = "*"; // change in production

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

		proc.stdout.on("data", (chunk) => {
			data += chunk.toString();
		});

		proc.stderr.on("data", (chunk) => {
			error += chunk.toString();
		});

		proc.on("close", (code) => {
			if (code !== 0) {
				return reject(new Error(error || "yt-dlp failed"));
			}

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

/* -------------------- HANDLER -------------------- */
export async function GET(req: Request) {
	try {
		const ip =
			req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";

		if (!rateLimit(ip)) {
			return Response.json(
				{ error: "Too many requests" },
				{ status: 429 },
			);
		}

		const { searchParams } = new URL(req.url);
		const videoId = searchParams.get("id");

		if (!videoId || !isValidVideoId(videoId)) {
			return Response.json(
				{ error: "Invalid or missing id" },
				{ status: 400 },
			);
		}

		const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

		let data = cache.get(videoId);

		// expire cache
		if (data && Date.now() - data.timestamp > CACHE_TTL) {
			cache.delete(videoId);
			data = undefined;
		}

		// fetch if not cached
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

		const contentType =
			data.ext === "m4a" ? "audio/mp4" : "audio/webm";

		// forward range header (CRITICAL)
		const range = req.headers.get("range");

		const upstream = await fetch(data.audioUrl, {
			headers: range ? { Range: range } : {},
		});

		if (!upstream.ok || !upstream.body) {
			return Response.json(
				{ error: "Upstream failed" },
				{ status: upstream.status },
			);
		}

		const headers = new Headers();

		headers.set("Content-Type", contentType);
		headers.set("Cache-Control", "no-store");
		headers.set("Accept-Ranges", "bytes");

		if (upstream.headers.has("content-length")) {
			headers.set(
				"Content-Length",
				upstream.headers.get("content-length")!,
			);
		}

		// metadata headers
		headers.set("X-Title", encodeURIComponent(data.title));
		headers.set("X-Duration", String(data.duration));

		// CORS
		headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
		headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
		headers.set(
			"Access-Control-Expose-Headers",
			"X-Title, X-Duration",
		);

		return new Response(upstream.body, { headers });
	} catch (err) {
		console.error("API Error:", err);
		return Response.json(
			{ error: "Internal server error" },
			{ status: 500 },
		);
	}
}

/* -------------------- OPTIONS -------------------- */
export function OPTIONS() {
	return new Response(null, {
		headers: {
			"Access-Control-Allow-Origin": ALLOWED_ORIGIN,
			"Access-Control-Allow-Methods": "GET, OPTIONS",
			"Access-Control-Allow-Headers": "*",
		},
	});
}
