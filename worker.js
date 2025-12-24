export default {
	async fetch(request, env) {
		if (request.method !== "POST") {
			return new Response("Method Not Allowed", { status: 405 });
			}

		const url = new URL(request.url);

		if (url.pathname !== "/analyze_social_video") {
			return new Response("Not Found", { status: 404 });
			}

		let body;

		try {
			body = await request.json();
			}
		catch {
			return new Response(
				JSON.stringify({ error: "Invalid JSON body" }),
				{ status: 400 }
				);
			}

		const { platform, video_url, include_transcript = true } = body;

		if (platform !== "youtube" || !video_url) {
			return new Response(
				JSON.stringify({ error: "Unsupported platform or missing URL" }),
				{ status: 400 }
				);
			}

		const videoId = extractYouTubeId(video_url);

		if (!videoId) {
			return new Response(
				JSON.stringify({ error: "Invalid YouTube URL" }),
				{ status: 400 }
				);
			}

		const metadata = await fetchYouTubeMetadata(videoId, env.YOUTUBE_API_KEY);

		if (!metadata) {
			return new Response(
				JSON.stringify({ error: "Video not found or unavailable" }),
				{ status: 404 }
				);
			}

		let transcript = {
			available: false,
			type: "none",
			text: ""
			};

		if (include_transcript) {
			const transcriptResult = await fetchYouTubeTranscript(videoId, env.YOUTUBE_API_KEY);

			if (transcriptResult) {
				transcript = transcriptResult;
				}
			}

		const response = {
			platform: "youtube",
			video_id: videoId,
			metadata,
			transcript,
			analysis_ready: true,
			limitations: [
				"No CTR data",
				"No retention graph access",
				"No impressions data"
				]
			};

		return new Response(JSON.stringify(response), {
			headers: {
				"Content-Type": "application/json"
				}
			});
		}
	};

function extractYouTubeId(videoUrl) {
	try {
		const url = new URL(videoUrl);

		if (url.hostname.includes("youtu.be")) {
			return url.pathname.slice(1);
			}

		if (url.hostname.includes("youtube.com")) {
			return url.searchParams.get("v");
			}

		return null;
		}
	catch {
		return null;
		}
}

async function fetchYouTubeMetadata(videoId, apiKey) {
	const endpoint =
		`https://www.googleapis.com/youtube/v3/videos` +
		`?part=snippet,statistics,contentDetails` +
		`&id=${videoId}` +
		`&key=${apiKey}`;

	const res = await fetch(endpoint);

	if (!res.ok) return null;

	const data = await res.json();

	if (!data.items || data.items.length === 0) return null;

	const video = data.items[0];

	return {
		title: video.snippet.title,
		description: video.snippet.description,
		duration_seconds: isoDurationToSeconds(video.contentDetails.duration),
		views: Number(video.statistics.viewCount || 0),
		likes: Number(video.statistics.likeCount || 0),
		comments: Number(video.statistics.commentCount || 0),
		publish_date: video.snippet.publishedAt.split("T")[0],
		channel: {
			name: video.snippet.channelTitle,
			subscribers: null
			}
		};
}

async function fetchYouTubeTranscript(videoId, apiKey) {
	const captionsEndpoint =
		`https://www.googleapis.com/youtube/v3/captions` +
		`?part=snippet` +
		`&videoId=${videoId}` +
		`&key=${apiKey}`;

	const res = await fetch(captionsEndpoint);

	if (!res.ok) return null;

	const data = await res.json();

	if (!data.items || data.items.length === 0) return null;

	const caption = data.items.find(c => c.snippet.language === "en") || data.items[0];

	const downloadEndpoint =
		`https://www.googleapis.com/youtube/v3/captions/${caption.id}` +
		`?tfmt=srt` +
		`&key=${apiKey}`;

	const transcriptRes = await fetch(downloadEndpoint);

	if (!transcriptRes.ok) return null;

	const text = await transcriptRes.text();

	return {
		available: true,
		type: caption.snippet.trackKind === "standard" ? "official" : "auto",
		text
		};
}

function isoDurationToSeconds(iso) {
	const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);

	if (!match) return 0;

	const hours = Number(match[1] || 0);
	const minutes = Number(match[2] || 0);
	const seconds = Number(match[3] || 0);

	return hours * 3600 + minutes * 60 + seconds;
}
