// GAME > [ SPREAD THE WORD ] (server/omhp/bounty.py): post about the game
// anywhere (Reddit, TikTok, YouTube, X...), drop the link here, get shards per
// upvote / like once the admin checks it.
// The trailer is here to download for your post, and your share link (the
// same one as YOU > PROFILE) pays 1,000 for every player it brings in.

import * as api from "../api.js?v=b6664395f3";
import { ago, el, fmt } from "../ascii.js?v=b6664395f3";
import { now } from "../store.js?v=b6664395f3";
import { showError } from "./errors.js?v=b6664395f3";
import { adminTag } from "./notice.js?v=b6664395f3";
import { shareSection } from "./referral.js?v=b6664395f3";

const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));

/** @type {any} */
let data = null;
let busy = false;
let draft = "";
let msg = "";

const SUGGESTED = [
  "One boss, one million HP. Everyone hits the same boss.",
  "ONE MILLION HP: a free browser game where the whole internet fights one ASCII boss together. onemillionhp.com",
];

export async function loadBounty() {
  try {
    data = await api.getBounty();
  } catch (e) {
    showError(/** @type {Error} */ (e).message);
  }
  render();
}

/** "10% of its upvotes and likes" / "2 shards for every upvote or like". @param {number} rate */
const rateText = (rate) => (rate < 1 ? `${Math.round(rate * 100)}% of its upvotes and likes in shards`
  : `${fmt(rate)} shards for every upvote or like`);

function render() {
  const host = $("panel-bounty");
  if (!host || host.hidden) return;
  // Typing a link: a redraw would wipe it.
  if (host.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") return;
  const parts = [el("div", "panel-h", "SPREAD THE WORD")];
  const rate = data?.rate ?? 0.1;
  parts.push(el("p", "bounty-lead", "More players, bigger fights. Post about ONE MILLION HP anywhere: Reddit, TikTok, "
    + "YouTube, X, Instagram, Facebook, forums, Discord servers. Drop the link here, and once it's checked your post "
    + `pays ${rateText(rate)}. Posts keep paying as they climb, and the more places you post, the more you earn.`));
  parts.push(el("div", "bounty-ach", "> your first approved post unlocks WORD OF MOUTH: +1,000 <>, however many "
    + "upvotes it gets. 5 posts: HYPE MACHINE, +3,000 <>. 25 posts: INFLUENCER, +10,000 <>."));

  // ---- 1. the trailer
  parts.push(el("div", "panel-h", "1. GRAB THE TRAILER"));
  if (data?.trailer) {
    const video = /** @type {HTMLVideoElement} */ (el("video", "bounty-video"));
    video.controls = true;
    video.preload = "metadata";
    video.playsInline = true;
    video.poster = `${api.API_BASE}/img/og.png`; // the link-preview card until you press play
    video.src = `${api.API_BASE}/media/omhp-trailer.mp4`;
    const dl = /** @type {HTMLAnchorElement} */ (el("a", "inline-btn bounty-dl", "[ DOWNLOAD THE TRAILER ] 38s :: 29 MB"));
    dl.href = `${api.API_BASE}/media/omhp-trailer.mp4?dl=1`;
    dl.download = "ONE-MILLION-HP-trailer.mp4";
    parts.push(video, dl, el("div", "dim bounty-note", "Use it in your post. It's yours to share."));
  } else {
    parts.push(el("div", "dim bounty-note", "> the trailer is on its way."));
  }

  // ---- 2. post
  parts.push(el("div", "panel-h", "2. POST IT ANYWHERE"));
  const ideas = el("div", "bounty-ideas");
  for (const line of SUGGESTED) {
    const row = el("div", "bounty-idea");
    const copy = el("button", "inline-btn", "[ COPY ]");
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(line);
        copy.textContent = "[ COPIED! ]";
      } catch {
        window.prompt("Copy this:", line);
      }
      setTimeout(() => (copy.textContent = "[ COPY ]"), 1500);
    });
    row.append(el("span", "", `"${line}"`), copy);
    ideas.append(row);
  }
  parts.push(el("div", "dim bounty-note", "Some lines to start from (say it your own way: a real post does better):"), ideas,
    el("div", "dim bounty-note", "Put your share link in it too: every player who joins through it and plays pays you 1,000 <> more."),
    shareSection(render, false)); // no "GOT A FRIEND'S CODE?" here: that's in YOU > PROFILE

  // ---- 3. drop the link
  parts.push(el("div", "panel-h", "3. DROP THE LINK"));
  const form = /** @type {HTMLFormElement} */ (el("form", "bounty-form"));
  const input = /** @type {HTMLInputElement} */ (el("input", "bounty-url"));
  input.type = "url";
  input.placeholder = "https://... (the link to your post)";
  input.maxLength = 300;
  input.value = draft;
  input.setAttribute("aria-label", "link to your post");
  input.addEventListener("input", () => (draft = input.value));
  const send = /** @type {HTMLButtonElement} */ (el("button", "inline-btn", "[ SUBMIT ]"));
  send.type = "submit";
  send.disabled = busy;
  form.append(input, send);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (busy || !draft.trim()) return;
    busy = true;
    input.blur();
    try {
      data = { ...data, ...(await api.postBounty(draft.trim())) };
      draft = "";
      msg = "got it! it's waiting to be checked.";
    } catch (e) {
      msg = "";
      showError(/** @type {Error} */ (e).message);
    }
    busy = false;
    render();
  });
  parts.push(form, el("div", "dim bounty-note",
    `Any site, as long as it's your own post about this game. ${data?.daily_limit ?? 5} links a day. Paid by hand, `
    + "so give it a day or two. Don't buy likes, ask for upvotes or vote for yourself: sites remove those posts, "
    + "and they won't be paid."));
  if (msg) parts.push(el("div", "bag-note bounty-msg", `> ${msg}`));

  // ---- your posts
  /** @type {any[]} */
  const posts = data?.posts ?? [];
  parts.push(el("div", "panel-h", `YOUR POSTS${posts.length ? ` :: ${posts.length}` : ""}`));
  if (!posts.length) parts.push(el("div", "dim bounty-note", "> none yet."));
  const list = el("div", "bounty-list");
  for (const p of posts) {
    const row = el("div", `bounty-row bounty-${p.status}`);
    const link = /** @type {HTMLAnchorElement} */ (el("a", "bounty-link", p.title || p.url));
    link.href = p.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const status = p.status === "rejected" ? "NOT PAID" : p.status !== "paid" ? "WAITING"
      : p.paid ? `PAID +${fmt(p.paid)} <>` : "APPROVED";
    const votes = p.score === null || p.score === undefined ? "not checked yet"
      : `${fmt(p.score)} ${p.reddit ? "upvotes" : "likes"} (${ago(now() - p.checked_at)} ago)`;
    const where = p.subreddit ? `r/${p.subreddit}` : p.site;
    row.append(link, el("div", "dim", `${where ? `${where} :: ` : ""}${votes} :: posted ${ago(now() - p.at)} ago`),
      el("div", `bounty-status ${p.status}`, status + (p.gone ? " :: REMOVED ON REDDIT" : "")));
    if (p.note) {
      const reply = el("div", "bounty-reply");
      reply.append(adminTag(), " ", el("span", "", p.note));
      row.append(reply);
    }
    list.append(row);
  }
  parts.push(list);
  host.replaceChildren(...parts);
}
