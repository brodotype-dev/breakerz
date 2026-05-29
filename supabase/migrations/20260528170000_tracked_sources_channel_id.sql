-- tracked_sources.discord_channel_id — Slice 4b of web-sourced-intel.
--
-- Slice 4a stored the source but not WHERE it was submitted. The recurring
-- cron (Slice 4b) re-scrapes active rows and posts the ✅/✏️/❌ proposal as a
-- fresh channel message via createChannelMessage — so it needs the channel id.
-- handleUrlSource now populates this from interaction.channel_id at submit time.
--
-- Nullable: pre-existing rows (one-shots already marked done) won't be picked
-- up by the cron, so a null channel_id on them is harmless. Any active
-- recurring row created from now on carries its channel.
--
-- Admin-only table (REVOKE already in place from 20260528160519) — column add
-- doesn't change grants, no NOTIFY needed (gotcha #10/#12).

alter table tracked_sources
  add column if not exists discord_channel_id text;
