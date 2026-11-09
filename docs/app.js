'use strict';
const video = document.querySelector('#hero-video');
const toggle = document.querySelector('#motion-toggle');
const status = document.querySelector('#playback-message');
const hero = document.querySelector('.hero');
const label = toggle.querySelector('span');
let wantedPlayback = false;
const syncPlayback = () => {
  const playing = !video.paused && !video.ended;
  hero.classList.toggle('is-playing', playing);
  toggle.setAttribute('aria-pressed', String(playing));
  label.textContent = playing ? 'Pause preview' : 'Play 24-second preview';
  toggle.querySelector('path').setAttribute('d', playing ? 'M8 5v14M16 5v14' : 'm8 5 11 7-11 7Z');
};
video.addEventListener('playing', () => {
  toggle.disabled = false; syncPlayback();
  status.textContent = '24-second excerpt · silent · fixed camera';
});
video.addEventListener('pause', syncPlayback);
video.addEventListener('waiting', () => { status.textContent = 'Loading preview…'; });
video.addEventListener('error', () => {
  wantedPlayback = false; toggle.disabled = false; syncPlayback();
  status.textContent = 'The preview could not load. Use “Open the preview video” below, or download the 4K file.';
});
toggle.addEventListener('click', async () => {
  if (!video.paused) { wantedPlayback = false; video.pause(); status.textContent = 'Preview paused. Fixed camera; no zoom or camera drift.'; return; }
  wantedPlayback = true; toggle.disabled = true; status.textContent = 'Loading preview…';
  try { await video.play(); } catch { wantedPlayback = false; toggle.disabled = false; status.textContent = 'Playback could not start. Open the preview video below to try again.'; }
});
// A user-started preview pauses when it leaves the page, and stays paused on return.
document.addEventListener('visibilitychange', () => { if (document.hidden) { wantedPlayback = false; video.pause(); } });
const observer = new IntersectionObserver(entries => {
  if (!entries[0].isIntersecting && wantedPlayback) { wantedPlayback = false; video.pause(); }
}, {threshold:0.05});
observer.observe(hero);

const selector = document.querySelector('#release-select');
const catalogStatus = document.querySelector('#catalog-status');
let catalog;
function setRelease(number) {
  const r = catalog.releases.find(r => r.version === Number(number));
  if (!r) return;
  const img = document.querySelector('#release-poster');
  img.src = r.poster; img.alt = `Night City v${r.version} ${r.title} wallpaper preview`;
  document.querySelector('#release-title').textContent = r.title;
  document.querySelector('#release-spec').textContent = `${r.width} × ${r.height} · ${r.fps} fps · ${r.durationSeconds} seconds`;
  document.querySelector('#release-note').textContent = r.notes;
  const link = document.querySelector('#release-download');
  link.href = r.download; link.setAttribute('aria-label', `Download Night City v${r.version} ${r.title}, 4K video`);
  document.querySelector('#release-notes').href = `https://github.com/korisame/phosphene-night-city/releases/tag/wallpaper-v${r.version}`;
  document.querySelector('#current-extras').hidden = r.version !== catalog.current;
}
selector.disabled = true;
fetch('releases.json').then(response => {
  if (!response.ok) throw new Error('Catalog unavailable');
  return response.json();
}).then(data => {
  if (!Array.isArray(data.releases) || data.releases.length !== 7) throw new Error('Invalid catalog');
  catalog = data; selector.disabled = false; setRelease(selector.value);
}).catch(() => {
  catalogStatus.textContent = 'The archive selector is unavailable. The current download above still works; all earlier versions are on GitHub Releases.';
});
selector.addEventListener('change', () => setRelease(selector.value));
