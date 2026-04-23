import { exec } from "child_process";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const videoId = searchParams.get("id");

    if (!videoId) {
      return Response.json({ error: "Missing id" }, { status: 400 });
    }

    const url = `https://www.youtube.com/watch?v=${videoId}`;

    // 1. Get metadata AND stream URL in a single call to save time
    const info: any = await new Promise((resolve, reject) => {
      // Fetch JSON dump specifically for the best audio format
      exec(`yt-dlp -j -f bestaudio "${url}"`, (err, stdout) => {
        if (err) return reject(err);
        try {
          resolve(JSON.parse(stdout));
        } catch (parseErr) {
          reject(parseErr);
        }
      });
    });
		console.log(info);

    const audioUrl = info.url; // The stream URL is included in the JSON dump
    
    // Determine correct content type based on the extension yt-dlp found
    const contentType = info.ext === 'm4a' ? 'audio/mp4' : 'audio/webm';

    // 2. Fetch audio stream from YouTube
    const upstream = await fetch(audioUrl);

    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "Upstream stream failed" }, { status: upstream.status });
    }

    // 3. Prepare headers
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "no-store");
    headers.set("Accept-Ranges", "bytes"); // Crucial for HTML5 <audio> seeking
    
    // Pass along content length if YouTube provided it
    if (upstream.headers.has("content-length")) {
        headers.set("Content-Length", upstream.headers.get("content-length") as string);
    }

    // Metadata headers
    headers.set("X-Title", encodeURIComponent(info.title || "Unknown Title"));
    headers.set("X-Duration", String(info.duration || 0));
    
    // CRITICAL: Allow the frontend to read these custom headers
    headers.set("Access-Control-Expose-Headers", "X-Title, X-Duration");

    // 4. Stream it to browser
    return new Response(upstream.body, { headers });

  } catch (err) {
    console.error("API Error:", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}