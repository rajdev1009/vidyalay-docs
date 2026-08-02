// =============================================================
// Vidyalay Coaching Centre Study Portal — frontend logic
// =============================================================

const API_BASE = window.location.origin; // same-origin deployment on Render

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let currentUserIdentifier = localStorage.getItem("vidyalay_identifier") || "";
let currentPreviewDocId = null;
let currentPreviewTitle = null;
let currentPreviewCategory = null;
let ownerWhatsappNumber = "917099451692"; // overwritten by loadBranding()

// Admin unlock code is kept ONLY in this tab's memory for this session —
// never written to localStorage, never hard-coded anywhere in this file.
// It is sent to the backend, which is the only place it's ever compared.
let adminCode = sessionStorage.getItem("vidyalay_admin_code") || null;

// Anonymous visitor ID — generated once per browser, persisted forever.
// Lets the owner see usage (searches/previews/downloads) even from
// visitors who never give an email.
function getVisitorId() {
  let id = localStorage.getItem("vidyalay_visitor_id");
  if (!id) {
    id = "v-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("vidyalay_visitor_id", id);
  }
  return id;
}
const visitorId = getVisitorId();

// ---------------------------------------------------------------
// Toast notifications
// ---------------------------------------------------------------
function showToast(message, isError = false) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  toast.style.background = isError ? "#B3261E" : "#0B1E3D";
  requestAnimationFrame(() => toast.classList.add("show"));
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.classList.add("hidden"), 200);
  }, 3200);
}

// ---------------------------------------------------------------
// Branding + categories + stats
// ---------------------------------------------------------------
async function loadBranding() {
  try {
    const res = await fetch(`${API_BASE}/api/branding`);
    const b = await res.json();
    document.querySelectorAll("#brand-name-nav, #brand-name-hero, #brand-name-footer")
      .forEach(el => (el.textContent = b.coaching_name));
    document.getElementById("brand-tagline").textContent = b.tagline;
    document.getElementById("disclaimer-text").textContent = b.disclaimer;
    document.getElementById("footer-email").textContent = b.email;
    document.getElementById("footer-email").href = `mailto:${b.email}`;
    document.getElementById("footer-phone").textContent = b.phone;
    document.getElementById("footer-phone").href = `tel:${b.phone.replace(/\s/g, "")}`;
    // WhatsApp deep links need digits only, with country code, no + or spaces
    ownerWhatsappNumber = (b.phone || "").replace(/[^\d]/g, "");
    document.getElementById("payment-fee").textContent = `₹${b.monthly_fee_inr}`;
    paymentMonthlyFee = b.monthly_fee_inr || paymentMonthlyFee;
    document.getElementById("upi-id-text").textContent = `UPI ID: ${b.upi_id}`;
  } catch (e) {
    console.error("branding load failed", e);
  }
}

const CATEGORY_ICONS = {
  "ADRE Grade III & IV": "📘",
  "Assam Police": "🛡️",
  "SSC Exams": "📝",
  "Railway Exams": "🚆",
  "Handwritten Notes": "✍️",
  "General Study Materials": "📚",
};

async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/api/categories`);
    const data = await res.json();
    const grid = document.getElementById("category-grid");
    const footerList = document.getElementById("footer-categories");
    const profileSelect = document.getElementById("profile-category");
    grid.innerHTML = "";
    footerList.innerHTML = "";
    if (profileSelect) {
      profileSelect.innerHTML = `<option value="">Preferred category (optional)</option>`;
      data.categories.forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        profileSelect.appendChild(opt);
      });
      const savedProfile = JSON.parse(localStorage.getItem("vidyalay_profile") || "{}");
      if (savedProfile.category) profileSelect.value = savedProfile.category;
    }
    data.categories.forEach(cat => {
      const card = document.createElement("button");
      card.className = "category-card p-5 text-left";
      card.innerHTML = `
        <div class="text-2xl mb-2">${CATEGORY_ICONS[cat] || "📄"}</div>
        <div class="font-semibold text-sm md:text-base">${cat}</div>
      `;
      card.addEventListener("click", () => runSearch("", cat));
      grid.appendChild(card);

      const li = document.createElement("li");
      li.innerHTML = `<button class="hover:text-[#F2B705]">${cat}</button>`;
      li.querySelector("button").addEventListener("click", () => runSearch("", cat));
      footerList.appendChild(li);
    });
  } catch (e) {
    console.error("categories load failed", e);
  }
}

async function loadStats() {
  try {
    const res = await fetch(`${API_BASE}/api/stats`);
    const s = await res.json();
    document.getElementById("stat-materials").textContent = s.total_materials ?? "0";
    document.getElementById("stat-downloads").textContent = s.total_downloads ?? "0";
    document.getElementById("stat-updated").textContent = s.last_updated
      ? new Date(s.last_updated).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
      : "—";
  } catch (e) {
    console.error("stats load failed", e);
  }
}

// ---------------------------------------------------------------
// Document card rendering
// ---------------------------------------------------------------
function docCardHTML(doc) {
  const uploadDate = new Date(doc.upload_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  return `
    <div class="doc-card p-5 flex flex-col">
      <div class="flex items-start justify-between mb-2">
        <span class="text-[10px] font-mono uppercase tracking-wide bg-[#F6F5F1] text-[#5A6478] px-2 py-1 rounded">${doc.category}</span>
        <span class="text-[10px] font-mono text-[#B7BECF]">#${doc.doc_id}</span>
      </div>
      <h3 class="font-display font-semibold text-base leading-snug mb-1.5">${doc.title}</h3>
      <p class="text-xs text-[#5A6478] leading-relaxed mb-3 line-clamp-2">${doc.description || ""}</p>
      <div class="text-[11px] text-[#8B93A7] flex items-center gap-3 mb-4">
        <span>${doc.file_size_mb} MB</span>
        <span>•</span>
        <span>${uploadDate}</span>
        <span>•</span>
        <span>${doc.download_count || 0} downloads</span>
      </div>
      <div class="mt-auto flex gap-2">
        <button class="preview-btn flex-1 h-9 rounded-md border border-[#0B1E3D] text-[#0B1E3D] text-xs font-semibold hover:bg-[#0B1E3D] hover:text-white transition-colors" data-id="${doc.doc_id}" data-title="${doc.title}" data-category="${doc.category}">Preview</button>
        <button class="download-btn flex-1 h-9 rounded-md bg-[#F2B705] hover:bg-[#e0a900] text-[#0B1E3D] text-xs font-semibold transition-colors" data-id="${doc.doc_id}" data-title="${doc.title}" data-category="${doc.category}">Download</button>
      </div>
    </div>
  `;
}

function skeletonCardHTML() {
  return `
    <div class="doc-card p-5">
      <div class="skeleton h-4 w-20 mb-3"></div>
      <div class="skeleton h-5 w-full mb-2"></div>
      <div class="skeleton h-3 w-3/4 mb-4"></div>
      <div class="skeleton h-9 w-full"></div>
    </div>
  `;
}

function attachCardHandlers(container) {
  container.querySelectorAll(".preview-btn").forEach(btn => {
    btn.addEventListener("click", () => openPreview(btn.dataset.id, btn.dataset.title, btn.dataset.category));
  });
  container.querySelectorAll(".download-btn").forEach(btn => {
    btn.addEventListener("click", () => attemptDownload(btn.dataset.id, btn.dataset.title, btn.dataset.category));
  });
}

// ---------------------------------------------------------------
// Search
// ---------------------------------------------------------------
async function runSearch(query, category) {
  const section = document.getElementById("results-section");
  const grid = document.getElementById("results-grid");
  const empty = document.getElementById("results-empty");

  section.classList.remove("hidden");
  empty.classList.add("hidden");
  section.scrollIntoView({ behavior: "smooth", block: "start" });

  grid.innerHTML = Array(6).fill(skeletonCardHTML()).join("");

  try {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (category) params.set("category", category);
    params.set("visitor_id", visitorId);
    if (currentUserIdentifier && currentUserIdentifier.includes("@")) params.set("email", currentUserIdentifier);
    const res = await fetch(`${API_BASE}/api/search?${params.toString()}`);
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      grid.innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }

    grid.innerHTML = data.items.map(docCardHTML).join("");
    attachCardHandlers(grid);
  } catch (e) {
    console.error("search failed", e);
    grid.innerHTML = "";
    empty.textContent = "Something went wrong while searching. Please try again.";
    empty.classList.remove("hidden");
    showToast("Search failed — please try again", true);
  }
}

async function loadRecent() {
  const grid = document.getElementById("recent-grid");
  grid.innerHTML = Array(4).fill(skeletonCardHTML()).join("");
  try {
    const res = await fetch(`${API_BASE}/api/recent?limit=10`);
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      grid.innerHTML = `<p class="text-sm text-[#8B93A7] col-span-full">No materials uploaded yet — check back soon.</p>`;
      return;
    }
    grid.innerHTML = data.items.slice(0, 8).map(docCardHTML).join("");
    attachCardHandlers(grid);
  } catch (e) {
    console.error("recent load failed", e);
    grid.innerHTML = `<p class="text-sm text-[#8B93A7] col-span-full">Could not load recent materials.</p>`;
  }
}

// ---------------------------------------------------------------
// PDF Preview (PDF.js)
// ---------------------------------------------------------------
async function openPreview(docId, title, category) {
  if (adminCode) {
    // Owner is unlocked — skip identifier prompt and subscription check entirely.
    return renderPreview(docId, title);
  }

  if (!currentUserIdentifier) {
    currentUserIdentifier = prompt("Enter your email to check subscription status:") || "";
    if (!currentUserIdentifier) return;
    localStorage.setItem("vidyalay_identifier", currentUserIdentifier);
  }

  // Preview is payment-gated per category, same as download — check first.
  try {
    const statusRes = await fetch(`${API_BASE}/api/subscription-status?identifier=${encodeURIComponent(currentUserIdentifier)}&category=${encodeURIComponent(category)}`);
    const status = await statusRes.json();
    if (!status.active) {
      openPaymentModal(docId, title, category);
      return;
    }
  } catch (e) {
    console.error("subscription check failed", e);
    showToast("Could not verify subscription — try again", true);
    return;
  }

  await renderPreview(docId, title, category);
}

async function renderPreview(docId, title, category) {
  currentPreviewDocId = docId;
  currentPreviewTitle = title || "";
  currentPreviewCategory = category || "";
  const modal = document.getElementById("preview-modal");
  const canvas = document.getElementById("pdf-canvas");
  const loading = document.getElementById("preview-loading");
  document.getElementById("preview-title").textContent = title || "Document Preview";

  modal.classList.remove("hidden");
  modal.classList.add("flex");
  canvas.classList.add("hidden");
  loading.classList.remove("hidden");
  loading.textContent = "Loading preview...";

  try {
    let url = `${API_BASE}/api/preview/${docId}?identifier=${encodeURIComponent(currentUserIdentifier || "admin")}&visitor_id=${encodeURIComponent(visitorId)}`;
    if (adminCode) url += `&admin_code=${encodeURIComponent(adminCode)}`;
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.4 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;

    loading.classList.add("hidden");
    canvas.classList.remove("hidden");
  } catch (e) {
    console.error("preview failed", e);
    loading.textContent = "Preview unavailable for this document.";
    showToast("Could not load preview", true);
  }
}

document.getElementById("preview-close-btn").addEventListener("click", () => {
  document.getElementById("preview-modal").classList.add("hidden");
  document.getElementById("preview-modal").classList.remove("flex");
});

document.getElementById("preview-download-btn").addEventListener("click", () => {
  if (currentPreviewDocId) attemptDownload(currentPreviewDocId, currentPreviewTitle, currentPreviewCategory);
});

// ---------------------------------------------------------------
// Download flow (payment-gated)
// ---------------------------------------------------------------
async function attemptDownload(docId, title, category) {
  if (adminCode) {
    // Owner is unlocked — free download, no identifier or subscription needed.
    showToast("Preparing your download...");
    const dlUrl = `${API_BASE}/api/download/${docId}?identifier=${encodeURIComponent(currentUserIdentifier || "admin")}&admin_code=${encodeURIComponent(adminCode)}`;
    const link = document.createElement("a");
    link.href = dlUrl;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("Download started ✅");
    return;
  }

  if (!currentUserIdentifier) {
    currentUserIdentifier = prompt("Enter your email to check subscription status:") || "";
    if (!currentUserIdentifier) return;
    localStorage.setItem("vidyalay_identifier", currentUserIdentifier);
  }

  try {
    const statusRes = await fetch(`${API_BASE}/api/subscription-status?identifier=${encodeURIComponent(currentUserIdentifier)}&category=${encodeURIComponent(category)}`);
    const status = await statusRes.json();

    if (!status.active) {
      openPaymentModal(docId, title, category);
      return;
    }

    showToast("Preparing your download...");
    const dlUrl = `${API_BASE}/api/download/${docId}?identifier=${encodeURIComponent(currentUserIdentifier)}&visitor_id=${encodeURIComponent(visitorId)}`;
    const link = document.createElement("a");
    link.href = dlUrl;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
    showToast("Download started ✅");
  } catch (e) {
    console.error("download check failed", e);
    showToast("Could not verify subscription — try again", true);
  }
}

// ---------------------------------------------------------------
// Payment modal
// ---------------------------------------------------------------
let paymentDocId = null;
let paymentDocTitle = null;
let paymentDocCategory = null;
let paymentMonthlyFee = 99;

function openPaymentModal(docId, title, category) {
  paymentDocId = docId || null;
  paymentDocTitle = title || null;
  paymentDocCategory = category || null;
  document.getElementById("payment-email-input").value = currentUserIdentifier || "";

  const selectedBox = document.getElementById("payment-selected-doc");
  const selectedTitleEl = document.getElementById("payment-selected-doc-title");
  if (paymentDocTitle) {
    selectedTitleEl.textContent = paymentDocCategory ? `${paymentDocTitle} (${paymentDocCategory})` : paymentDocTitle;
    selectedBox.classList.remove("hidden");
  } else {
    selectedBox.classList.add("hidden");
  }

  const modal = document.getElementById("payment-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

document.getElementById("payment-close-btn").addEventListener("click", closePaymentModal);
function closePaymentModal() {
  document.getElementById("payment-modal").classList.add("hidden");
  document.getElementById("payment-modal").classList.remove("flex");
}

// "Continue on WhatsApp" — logs the order intent, then opens a WhatsApp chat
// with the owner's number and a pre-filled English message describing the
// selected document and the amount. WhatsApp links can't attach an image
// automatically, so the message asks the user to attach their payment
// screenshot themselves before sending.
document.getElementById("payment-continue-btn").addEventListener("click", async () => {
  const email = document.getElementById("payment-email-input").value.trim();
  if (!email) {
    showToast("Please enter your email first", true);
    return;
  }
  currentUserIdentifier = email;
  localStorage.setItem("vidyalay_identifier", email);

  // Log the order intent in the background so the owner also sees it via /stats.
  try {
    await fetch(`${API_BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, doc_id: paymentDocId, category: paymentDocCategory, amount_inr: paymentMonthlyFee }),
    });
  } catch (e) {
    console.error("order logging failed", e);
    // Non-blocking — still continue to WhatsApp even if this fails.
  }

  const itemLine = paymentDocTitle
    ? `Item: ${paymentDocTitle}${paymentDocId ? " (ID: " + paymentDocId + ")" : ""}${paymentDocCategory ? "\nCategory: " + paymentDocCategory : ""}`
    : "Item: Monthly subscription";

  const message =
    `Hello, I would like to unlock access on Vidyalay Coaching Centre Study Portal.\n\n` +
    `${itemLine}\n` +
    `Amount paid: Rs. ${paymentMonthlyFee}\n` +
    `My email: ${email}\n\n` +
    `I have made the payment. Attaching my payment screenshot below.`;

  const waUrl = `https://wa.me/${ownerWhatsappNumber}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, "_blank");

  showToast("Opening WhatsApp — please attach your payment screenshot and send.");
  closePaymentModal();
});

document.getElementById("nav-subscribe-btn").addEventListener("click", () => openPaymentModal(null, null));

// ---------------------------------------------------------------
// Search input handlers
// ---------------------------------------------------------------
document.getElementById("search-btn").addEventListener("click", () => {
  const q = document.getElementById("search-input").value.trim();
  runSearch(q, null);
});
document.getElementById("search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    runSearch(e.target.value.trim(), null);
  }
});
document.querySelectorAll(".quick-search").forEach(btn => {
  btn.addEventListener("click", () => {
    document.getElementById("search-input").value = btn.dataset.q;
    runSearch(btn.dataset.q, null);
  });
});
document.getElementById("clear-search").addEventListener("click", () => {
  document.getElementById("results-section").classList.add("hidden");
  document.getElementById("search-input").value = "";
});

// ---------------------------------------------------------------
// Three-dot menu (Admin / Developer)
// ---------------------------------------------------------------
const moreMenuBtn = document.getElementById("more-menu-btn");
const moreMenuDropdown = document.getElementById("more-menu-dropdown");

moreMenuBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  moreMenuDropdown.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!moreMenuDropdown.classList.contains("hidden") && !moreMenuDropdown.contains(e.target) && e.target !== moreMenuBtn) {
    moreMenuDropdown.classList.add("hidden");
  }
});

document.getElementById("menu-admin-btn").addEventListener("click", () => {
  moreMenuDropdown.classList.add("hidden");
  openAdminModal();
});
document.getElementById("menu-developer-btn").addEventListener("click", () => {
  moreMenuDropdown.classList.add("hidden");
  openDeveloperModal();
});

// ---------------------------------------------------------------
// Admin panel — theme colour + edit profile
// ---------------------------------------------------------------
const THEME_COLORS = [
  { name: "Yellow (default)", hex: "#F2B705" },
  { name: "Amber", hex: "#F59E0B" },
  { name: "Orange", hex: "#F97316" },
  { name: "Red", hex: "#EF4444" },
  { name: "Rose", hex: "#F43F5E" },
  { name: "Pink", hex: "#EC4899" },
  { name: "Fuchsia", hex: "#D946EF" },
  { name: "Purple", hex: "#A855F7" },
  { name: "Violet", hex: "#8B5CF6" },
  { name: "Indigo", hex: "#6366F1" },
  { name: "Blue", hex: "#3B82F6" },
  { name: "Sky", hex: "#0EA5E9" },
  { name: "Cyan", hex: "#06B6D4" },
  { name: "Teal", hex: "#14B8A6" },
  { name: "Emerald", hex: "#10B981" },
  { name: "Green", hex: "#22C55E" },
  { name: "Lime", hex: "#84CC16" },
  { name: "Gold", hex: "#D4AF37" },
];

function darkenHex(hex, amount = 0.15) {
  const n = hex.replace("#", "");
  const r = Math.max(0, Math.round(parseInt(n.substring(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(n.substring(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(n.substring(4, 6), 16) * (1 - amount)));
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

function applyThemeColor(hex, save = true) {
  const dark = darkenHex(hex);
  let styleTag = document.getElementById("theme-override-style");
  if (!styleTag) {
    styleTag = document.createElement("style");
    styleTag.id = "theme-override-style";
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = `
    .bg-\\[\\#F2B705\\] { background-color: ${hex} !important; }
    .hover\\:bg-\\[\\#e0a900\\]:hover { background-color: ${dark} !important; }
    .text-\\[\\#F2B705\\] { color: ${hex} !important; }
    .hover\\:text-\\[\\#F2B705\\]:hover { color: ${hex} !important; }
    .border-\\[\\#F2B705\\] { border-color: ${hex} !important; }
    .border-\\[\\#F2B705\\]\\/30 { border-color: ${hex}4D !important; }
    .border-\\[\\#F2B705\\]\\/40 { border-color: ${hex}66 !important; }
    .focus\\:ring-\\[\\#F2B705\\]:focus { --tw-ring-color: ${hex} !important; }
    .doc-card:hover, .category-card:hover { border-color: ${hex} !important; }
  `;
  if (save) localStorage.setItem("vidyalay_theme_color", hex);
}

function renderThemeSwatches() {
  const container = document.getElementById("theme-swatches");
  const current = localStorage.getItem("vidyalay_theme_color") || THEME_COLORS[0].hex;
  container.innerHTML = "";
  THEME_COLORS.forEach(c => {
    const btn = document.createElement("button");
    btn.title = c.name;
    btn.className = "w-8 h-8 rounded-full border-2 transition-transform hover:scale-110";
    btn.style.backgroundColor = c.hex;
    btn.style.borderColor = c.hex === current ? "#0B1E3D" : "transparent";
    btn.addEventListener("click", () => {
      applyThemeColor(c.hex);
      renderThemeSwatches();
      showToast(`Theme colour set to ${c.name}`);
    });
    container.appendChild(btn);
  });
}

function openAdminModal() {
  renderThemeSwatches();
  const saved = JSON.parse(localStorage.getItem("vidyalay_profile") || "{}");
  document.getElementById("profile-name").value = saved.name || "";
  document.getElementById("profile-email").value = saved.email || currentUserIdentifier || "";
  document.getElementById("profile-number").value = saved.number || "";
  const modal = document.getElementById("admin-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}
document.getElementById("admin-close-btn").addEventListener("click", () => {
  document.getElementById("admin-modal").classList.add("hidden");
  document.getElementById("admin-modal").classList.remove("flex");
});

document.getElementById("profile-save-btn").addEventListener("click", () => {
  const name = document.getElementById("profile-name").value.trim();
  const email = document.getElementById("profile-email").value.trim();
  const number = document.getElementById("profile-number").value.trim();
  const category = document.getElementById("profile-category").value;

  localStorage.setItem("vidyalay_profile", JSON.stringify({ name, email, number, category }));
  if (email) {
    currentUserIdentifier = email;
    localStorage.setItem("vidyalay_identifier", email);
  }
  showToast("Profile saved ✅");
  document.getElementById("admin-modal").classList.add("hidden");
  document.getElementById("admin-modal").classList.remove("flex");
});

// ---------------------------------------------------------------
// Developer panel — about, ID lookup, owner-only unlock
// ---------------------------------------------------------------
async function openDeveloperModal() {
  const modal = document.getElementById("developer-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");

  const statusEl = document.getElementById("dev-code-status");
  if (adminCode) {
    statusEl.textContent = "Unlocked ✅";
    statusEl.classList.remove("hidden");
  } else {
    statusEl.classList.add("hidden");
  }

  try {
    const res = await fetch(`${API_BASE}/api/developer`);
    const dev = await res.json();
    document.getElementById("developer-about-text").textContent = dev.about;
    document.getElementById("developer-name").textContent = dev.name;
    document.getElementById("developer-role").textContent = dev.role;
    document.getElementById("developer-telegram").textContent = dev.telegram;
    document.getElementById("developer-telegram").href = `https://t.me/${(dev.telegram || "").replace("@", "")}`;
    document.getElementById("developer-skills").innerHTML = (dev.skills || [])
      .map(s => `<span class="text-[10px] font-mono bg-white border border-[#EAE7DD] rounded px-2 py-1">${s}</span>`)
      .join("");
  } catch (e) {
    console.error("developer info load failed", e);
    document.getElementById("developer-about-text").textContent = "Could not load developer info.";
  }
}
document.getElementById("developer-close-btn").addEventListener("click", () => {
  document.getElementById("developer-modal").classList.add("hidden");
  document.getElementById("developer-modal").classList.remove("flex");
});

async function handleDevSearch() {
  const input = document.getElementById("dev-search-input");
  const value = input.value.trim();
  const resultBox = document.getElementById("dev-id-result");
  const statusEl = document.getElementById("dev-code-status");
  if (!value) return;

  // Hidden wipe command — only works if already unlocked as admin.
  if (value.toLowerCase() === "/devraj") {
    input.value = "";
    if (!adminCode) return; // not unlocked yet — silently ignore
    const sure1 = confirm(
      "This will permanently DELETE ALL uploaded document records from the database.\n\n" +
      "Your files on the Telegram storage channel will NOT be touched — only the site's listing is cleared.\n\n" +
      "This cannot be undone. Continue?"
    );
    if (!sure1) return;
    const typed = prompt('Type DELETE ALL to confirm:');
    if (typed !== "DELETE ALL") {
      showToast("Cancelled — nothing was deleted");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/internal/admin/wipe-documents?code=${encodeURIComponent(adminCode)}`, { method: "DELETE" });
      const data = await res.json();
      showToast(`Deleted ${data.deleted_count ?? 0} document records`);
      loadRecent();
      loadStats();
      document.getElementById("results-section").classList.add("hidden");
    } catch (e) {
      console.error("wipe failed", e);
      showToast("Delete failed — try again", true);
    }
    return;
  }

  // First, silently check if this is the owner's unlock code.
  try {
    const verifyRes = await fetch(`${API_BASE}/api/admin/verify?code=${encodeURIComponent(value)}`);
    const verifyData = await verifyRes.json();
    if (verifyData.valid) {
      adminCode = value;
      sessionStorage.setItem("vidyalay_admin_code", value);
      input.value = "";
      resultBox.classList.add("hidden");
      statusEl.classList.remove("hidden");
      statusEl.textContent = "Unlocked ✅";
      showToast("Unlocked");
      return;
    }
  } catch (e) {
    console.error("verify check failed", e);
  }

  // Otherwise, treat it as a normal document ID / keyword search.
  resultBox.classList.remove("hidden");
  resultBox.innerHTML = `<p class="text-[#8B93A7]">Searching...</p>`;
  try {
    const res = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(value)}`);
    const data = await res.json();
    if (!data.items || data.items.length === 0) {
      resultBox.innerHTML = `<p class="text-[#8B93A7]">No document found.</p>`;
      return;
    }
    const doc = data.items[0];
    resultBox.innerHTML = `
      <p class="font-semibold mb-1">${doc.title}</p>
      <p class="text-xs text-[#5A6478] mb-3">${doc.category} • ${doc.file_size_mb} MB • #${doc.doc_id}</p>
      <div class="flex gap-2">
        <button id="dev-result-preview" class="flex-1 h-9 rounded-md border border-[#0B1E3D] text-[#0B1E3D] text-xs font-semibold hover:bg-[#0B1E3D] hover:text-white">Preview</button>
        <button id="dev-result-download" class="flex-1 h-9 rounded-md bg-[#F2B705] hover:bg-[#e0a900] text-[#0B1E3D] text-xs font-semibold">Download</button>
      </div>
    `;
    document.getElementById("dev-result-preview").addEventListener("click", () => openPreview(doc.doc_id, doc.title, doc.category));
    document.getElementById("dev-result-download").addEventListener("click", () => attemptDownload(doc.doc_id, doc.title, doc.category));
  } catch (e) {
    console.error("dev search failed", e);
    resultBox.innerHTML = `<p class="text-[#8B93A7]">Search failed — try again.</p>`;
  }
}
document.getElementById("dev-search-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleDevSearch();
});

// ---------------------------------------------------------------
// Init
// ---------------------------------------------------------------
loadBranding();
loadCategories();
loadStats();
loadRecent();
applyThemeColor(localStorage.getItem("vidyalay_theme_color") || THEME_COLORS[0].hex, false);
  
