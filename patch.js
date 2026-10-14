/* HOMESTRIP patch: adapts the app to the new database. Load AFTER the main script. */
const BUCKET = 'media', signed = {};
let myUid = null, myEmail = '';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const naira = k => '₦' + (Number(k || 0) / 100).toLocaleString();

async function loadUserDataFromCloud() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { myUid = null; return; }
  myUid = session.user.id; myEmail = session.user.email;
  const now = new Date().toISOString();
  const [u, s, v] = await Promise.all([
    supabaseClient.from('user_unlocks').select('post_id'),
    supabaseClient.from('saved_posts').select('post_id'),
    supabaseClient.from('subscriptions').select('creator_id').eq('status', 'active').gt('current_period_end', now)
  ]);
  unlockedPostIds = (u.data || []).map(x => x.post_id);
  savedPostIds = (s.data || []).map(x => x.post_id);
  activeSubscriptions = (v.data || []).map(x => x.creator_id);
}

async function checkAuthStatus() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  document.getElementById('auth-section').style.display = session ? 'none' : 'block';
  document.getElementById('studio-post-section').style.display = session ? 'block' : 'none';
  if (session) { await loadUserDataFromCloud(); loadStats(); }
}

async function loadStats() {
  const { data } = await supabaseClient.from('transactions').select('creator_earning_kobo')
    .eq('creator_id', myUid).eq('status', 'succeeded');
  const t = (data || []).reduce((a, x) => a + x.creator_earning_kobo, 0);
  document.getElementById('total-revenue').innerText = naira(t);
  document.getElementById('net-balance').innerText = naira(t);
  document.getElementById('total-unlocks').innerText = (data || []).length;
}

async function renderFeed() {
  const c = document.getElementById('posts-container');
  const { data, error } = await supabaseClient.from('posts')
    .select('*,creators(id,subscription_price_kobo,profiles(username,display_name,avatar_url)),media(storage_path,kind),comments(id,body,profiles(username))')
    .order('id', { ascending: false });
  if (error) { c.innerHTML = `<p style="text-align:center;padding:20px">${esc(error.message)}</p>`; return; }
  cachedPosts = data;
  const paths = data.flatMap(p => p.media.map(m => m.storage_path));
  if (paths.length) {
    const r = await supabaseClient.storage.from(BUCKET).createSignedUrls(paths, 3600);
    (r.data || []).forEach(x => { if (x.signedUrl) signed[x.path] = x.signedUrl; });
  }
  displayPosts(data);
}

function card(p) {
  const cr = p.creators || {}, pr = cr.profiles || {}, name = esc(pr.display_name || pr.username || 'Creator');
  const M = p.media, ok = M.length > 0, ppv = p.visibility === 'ppv';
  const saved = savedPostIds.includes(p.id), subbed = activeSubscriptions.includes(p.creator_id);
  const src = ok ? (signed[M[0].storage_path] || '') : '';
  const media = ok ? (M[0].kind === 'video' ? `<video src="${src}" controls playsinline preload="metadata"></video>` : `<img src="${src}" loading="lazy">`) : '';
  const lock = ok ? '' : `<div class="paywall-overlay"><div class="price-tag">${ppv ? naira(p.ppv_price_kobo) : '⭐ VIP only'}</div>${ppv ? `<button class="btn-unlock" onclick="pay('ppv',${p.id})">Unlock Content</button>` : ''}</div>`;
  const cm = (p.comments || []).map(c => `<div class="comment-bubble"><b>${esc(c.profiles?.username || 'user')}</b>: ${esc(c.body)}</div>`).join('') || '<p style="font-size:11px;color:var(--text-muted);padding:4px">No comments yet.</p>';
  return `<div class="post-card">
<div class="post-header"><div class="post-header-left"><div class="avatar">${pr.avatar_url ? `<img src="${esc(pr.avatar_url)}">` : name[0]}</div><div class="creator-info"><h4>${name}</h4><span>@${esc(pr.username || '')} • <b style="color:var(--accent)">${ppv ? 'Exclusive' : 'VIP'}</b></span></div></div>
<div class="post-actions-top"><button class="action-icon-btn ${saved ? 'saved' : ''}" onclick="toggleSavePost(${p.id})">${saved ? '❤️ Saved' : '🤍 Save'}</button></div></div>
<div class="media-container ${ok ? '' : 'locked'}">${media}${lock}<div class="watermark brand-name">HOME<span>STRIP</span></div></div>
<div class="post-caption">${esc(p.caption)}</div>
<div class="post-footer-actions"><button class="btn-tip" onclick="pay('tip',null,'${p.creator_id}')">💸 Tip</button>${subbed ? '<span style="font-size:12px;color:var(--accent);font-weight:800;align-self:center">VIP Subscribed ⭐</span>' : `<button class="btn-tip" style="border-color:var(--primary);color:var(--primary)" onclick="pay('sub',null,'${p.creator_id}')">⭐ VIP Pass (${naira(cr.subscription_price_kobo)}/mo)</button>`}</div>
<div class="comments-section"><div style="display:flex;gap:8px"><input id="comment-input-${p.id}" class="form-control" placeholder="Add a comment..." style="padding:10px;font-size:12px"><button class="btn-accent" style="width:auto;padding:0 14px;font-size:12px" onclick="postComment(${p.id})">Post</button></div><div class="comments-list">${cm}</div></div></div>`;
}

function displayPosts(posts) {
  const c = document.getElementById('posts-container');
  let f = posts.filter(p => Array.isArray(p.media));
  if (currentCategoryFilter === 'Saved') f = f.filter(p => savedPostIds.includes(p.id));
  else if (currentCategoryFilter === 'Video') f = f.filter(p => p.media.some(m => m.kind === 'video'));
  else if (currentCategoryFilter === 'Exclusive') f = f.filter(p => p.visibility === 'ppv');
  else if (currentCategoryFilter === 'VIP') f = f.filter(p => p.visibility === 'subscribers');
  if (searchQuery) f = f.filter(p => (p.caption || '').toLowerCase().includes(searchQuery) || (p.creators?.profiles?.username || '').includes(searchQuery));
  c.innerHTML = f.length ? f.map(card).join('') : '<p style="text-align:center;color:var(--text-muted);padding:30px">No drops found.</p>';
}

async function renderUnlockedLibrary() {
  if (!cachedPosts.length) await renderFeed();
  const mine = cachedPosts.filter(p => Array.isArray(p.media) && p.media.length && (unlockedPostIds.includes(p.id) || activeSubscriptions.includes(p.creator_id)));
  document.getElementById('unlocked-posts-container').innerHTML = mine.length ? mine.map(card).join('') : '<p style="text-align:center;color:var(--text-muted);padding:20px">No unlocked content yet.</p>';
}

async function toggleSavePost(id) {
  if (!myUid) return alert('Log in first (Studio tab).');
  if (savedPostIds.includes(id)) {
    savedPostIds = savedPostIds.filter(x => x !== id);
    await supabaseClient.from('saved_posts').delete().eq('user_id', myUid).eq('post_id', id);
  } else {
    savedPostIds.push(id);
    await supabaseClient.from('saved_posts').insert({ user_id: myUid, post_id: id });
  }
  displayPosts(cachedPosts);
}

async function postComment(id) {
  if (!myUid) return alert('Log in first (Studio tab).');
  const input = document.getElementById('comment-input-' + id);
  if (!input.value.trim()) return;
  await supabaseClient.from('comments').insert({ post_id: id, user_id: myUid, body: input.value.trim() });
  renderFeed();
}

async function createPost() {
  if (!myUid) await loadUserDataFromCloud();
  if (!myUid) return alert('Log in first.');
  const cat = document.getElementById('post-category').value;
  const caption = document.getElementById('post-caption-input').value;
  const price = Number(document.getElementById('post-price').value || 0);
  const file = document.getElementById('media-file-input').files[0];
  const st = document.getElementById('upload-status'), btn = document.getElementById('publish-btn');
  if (!caption) return alert('Enter a caption');
  if (!file) return alert('Select a media file.');
  const vis = cat === 'VIP' ? 'subscribers' : 'ppv';
  if (vis === 'ppv' && price < 100) return alert('Minimum price is ₦100.');
  const done = () => { st.style.display = 'none'; btn.disabled = false; };
  st.style.display = 'block'; btn.disabled = true;
  const path = `${myUid}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${file.name.split('.').pop()}`;
  const up = await supabaseClient.storage.from(BUCKET).upload(path, file);
  if (up.error) { done(); return alert('Upload failed: ' + up.error.message); }
  const { data: post, error } = await supabaseClient.from('posts')
    .insert({ creator_id: myUid, caption, visibility: vis, ppv_price_kobo: vis === 'ppv' ? price * 100 : null })
    .select().single();
  if (error) { done(); return alert('Publish failed: ' + error.message + '\n(Is this account set up as a creator?)'); }
  const m = await supabaseClient.from('media').insert({ post_id: post.id, storage_path: path, kind: file.type.startsWith('video') ? 'video' : 'image' });
  done();
  if (m.error) return alert('Media save failed: ' + m.error.message);
  alert('Uploaded! It goes live after review.');
  document.getElementById('post-caption-input').value = '';
  document.getElementById('media-file-input').value = '';
  switchTab('feed');
}

function pay(type, postId, creatorId) {
  if (!myUid) return alert('Log in first (Studio tab).');
  let kobo;
  if (type === 'ppv') {
    const p = cachedPosts.find(x => x.id === postId);
    kobo = p.ppv_price_kobo; creatorId = p.creator_id;
  } else if (type === 'sub') {
    kobo = cachedPosts.find(x => x.creator_id === creatorId)?.creators?.subscription_price_kobo;
  } else {
    const a = Number(prompt('Tip amount (₦):', '1000'));
    if (!(a >= 100)) return;
    kobo = a * 100;
  }
  if (!kobo) return alert('Price not set.');
  const ref = 'hs_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  PaystackPop.setup({
    key: PAYSTACK_PUB_KEY, email: myEmail, amount: kobo, currency: 'NGN', ref,
    metadata: { type, post_id: postId, creator_id: creatorId },
    callback: r => { verifyPayment(r.reference); },
    onClose: () => {}
  }).openIframe();
}

async function verifyPayment(ref) {
  const { data, error } = await supabaseClient.functions.invoke('verify-payment', { body: { reference: ref } });
  if (error || !data?.ok) return alert('Payment received but not confirmed yet. Keep this reference: ' + ref);
  await loadUserDataFromCloud();
  await renderFeed();
  alert('Payment confirmed ✅');
}

/* Paused until rebuilt on the new tables */
function payWithPaystack() { alert('Please use the buttons in the Feed.'); }
function openProfile() {}
async function renderChatInbox() { document.getElementById('global-chat-box').innerHTML = '<div class="chat-bubble fan">Chat is being upgraded. Coming soon.</div>'; }
async function sendChatMessage() {}
async function sendPaywalledDM() {}

loadUserDataFromCloud().then(renderFeed);
