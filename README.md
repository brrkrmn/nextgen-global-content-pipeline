# Nextgen Global Content Pipeline

Automating:
- pulling videos from a Vimeo folder,
- creating ElevenLabs dubbing projects for given videos,
- rendering/exporting finalized dubs, and
- tracking everything in local JSON files.

---

## 📁 Folder Structure
```
.
├── data
│   ├── dubbings.json      # Local source of ElevenLabs dubbing projects
│   └── videos.json        # Local cache of Vimeo videos (alphabetically fetched) and their download URLs
├── src
│   ├── dub.js             # Creates ElevenLabs dubbing projects from videos.json, creates dubbings.json
│   ├── export.js          # Renders/exports ready projects; updates dubbings.json
│   ├── list.js            # Lists Vimeo folder videos; builds/refreshes videos.json
│   └── vimeo.js           # Vimeo API utilities (auth, listing, helpers)
└── .env                 
```

### `dubbings.json`
ElevenLabs dubbing project details are stored here.

Before **render/export**, a project entry looks like:

    {
      "dubbingId": "eg",
      "name": "eg",
      "videoId": "eg",
      "targetLanguages": [
        "en"
      ],
      "createdAt": "2025-08-22T07:26:32.489Z"
    }

After **render + export**, the same project is updated to:

    {
      "dubbingId": "elevenlabsDubbingId",
      "name": "vimeoId_vimeoTitle #exported",
      "videoId": "eg",
      "targetLanguages": [
        "en"
      ],
      "createdAt": "2025-08-22T07:26:36.706Z",
      "renderId": "eg",
      "downloadUrl": "eg.mp4",
      "renderedAt": "2025-08-22T11:12:20.020Z",
      "renderLanguage": "en",
      "status": "exported"
    }

### `videos.json`
Contains Vimeo videos fetched **alphabetically** from a specific Vimeo folder. Example object:

    {
      "id": "eg",              // Vimeo video ID
      "name": "eg",            // Vimeo title
      "downloadUrl": "https://player.vimeo.com/..."
    }

> Note: Vimeo download URLs can expire over time.

---

## Commands

### `npm run list`
Fetches Vimeo videos (alphabetically) and builds/updates `data/videos.json`.

- Run once to seed `videos.json`.
- If you plan to dub again **after a long time**, Vimeo `downloadUrl` links may have expired.
  - In that case, delete `data/videos.json` and run `npm run list` again to refresh links.

### `npm run dub`
Creates ElevenLabs dubbing projects from `data/videos.json`.

- For each video:
  - `url`: Vimeo `downloadUrl`
  - `name`: `vimeoId_vimeoTitle`
  - `sourceLang`: `tr`
  - `targetLang`: `en`
  - `numSpeakers`: `1`
  - `watermark`: `true` (we don’t need the original video stream)
  - `dubbingStudio`: `true` (so the project can be edited later in the studio)
  - `mode`: `automatic` (auto voice extraction)

  - This command is safe to run multiple times. If a dubbing project already exists for a video, it won’t create another one—saves credits.
    - As credits renew, run again to dub remaining videos.
    - If it’s been a while and Vimeo links have expired, delete `videos.json` and re-run `npm run list` first.

### `npm run export`
Renders & exports the **ready** (approved) ElevenLabs dubbing projects and updates `data/dubbings.json`.

- **How readiness is selected**:
  - The team agrees on a `READY_KEYWORD`.
  - When a dubbing project title in ElevenLabs **contains** that keyword, it will be rendered/exported.
- **After a successful export**:
  - The program updates the project title to include the team’s `EXPORTED_KEYWORD` in ElevenLabs.
  - `data/dubbings.json` is updated with `renderId`, `downloadUrl`, `renderedAt`, `renderLanguage`, and `status: "exported"`.
- **Re-render flow**:
  - If you edit a project and want a new render, change the project title back to the `READY_KEYWORD`.
  - Run `npm run export` again.
  - The existing entry in `dubbings.json` is **updated in place**.

---

## Summary

- Use `npm run list` to populate/refresh Vimeo videos (alphabetically).
- Use `npm run dub` to create ElevenLabs dubbing projects from those videos.
- Mark projects ready by adding `READY_KEYWORD` to their titles in ElevenLabs.
- Use `npm run export` to render/export ready projects; titles will be updated to `EXPORTED_KEYWORD`, and `dubbings.json` will be updated accordingly.
