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
let currentPreviewIsPremium = false;
let currentPreviewFilePrice = "";
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

// Custom styled email prompt — replaces the native browser prompt() dialog,
// which can't be restyled (it's rendered by the browser itself, not the page).
function askForEmail() {
  return new Promise((resolve) => {
    const modal = document.getElementById("email-modal");
    const input = document.getElementById("email-modal-input");
    const okBtn = document.getElementById("email-modal-ok");
    const cancelBtn = document.getElementById("email-modal-cancel");

    input.value = "";
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    setTimeout(() => input.focus(), 50);

    function cleanup() {
      modal.classList.add("hidden");
      modal.classList.remove("flex");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      input.removeEventListener("keydown", onKeydown);
    }
    function onOk() {
      const value = input.value.trim();
      cleanup();
      resolve(value);
    }
    function onCancel() {
      cleanup();
      resolve("");
    }
    function onKeydown(e) {
      if (e.key === "Enter") onOk();
      if (e.key === "Escape") onCancel();
    }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    input.addEventListener("keydown", onKeydown);
  });
}

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

let allCourses = []; // cached course info (pricing/type/location) after loadCategories()

async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/api/categories`);
    const data = await res.json();
    allCourses = data.categories; // [{category, type, location, full_course_price, monthly_price}, ...]

    const grid = document.getElementById("category-grid");
    const footerList = document.getElementById("footer-categories");
    const profileSelect = document.getElementById("profile-category");
    grid.innerHTML = "";
    footerList.innerHTML = "";
    if (profileSelect) {
      profileSelect.innerHTML = `<option value="">Preferred category (optional)</option>`;
      allCourses.forEach(c => {
        const opt = document.createElement("option");
        opt.value = c.category;
        opt.textContent = c.category;
        profileSelect.appendChild(opt);
      });
      const savedProfile = JSON.parse(localStorage.getItem("vidyalay_profile") || "{}");
      if (savedProfile.category) profileSelect.value = savedProfile.category;
    }
    allCourses.forEach(c => {
      const card = document.createElement("button");
      card.className = "category-card p-5 text-left";
      const locationBadge = c.type === "offline" && c.location
        ? `<span class="inline-block text-[10px] font-semibold bg-[#F6F5F1] text-[#5A6478] px-2 py-0.5 rounded-full mb-1.5">📍 ${c.location}</span>`
        : `<span class="inline-block text-[10px] font-semibold bg-[#F6F5F1] text-[#5A6478] px-2 py-0.5 rounded-full mb-1.5">💻 Online</span>`;
      const priceLine = c.full_course_price
        ? `Monthly ₹${c.monthly_price} · Full ₹${c.full_course_price}`
        : `Monthly ₹${c.monthly_price}`;
      card.innerHTML = `
        <div class="text-2xl mb-2">${CATEGORY_ICONS[c.category] || "📄"}</div>
        <div class="font-semibold text-sm md:text-base mb-1">${c.category}</div>
        ${locationBadge}
        <div class="text-[11px] text-[#8B93A7]">${priceLine}</div>
      `;
      card.addEventListener("click", () => runSearch("", c.category));
      grid.appendChild(card);

      const li = document.createElement("li");
      li.innerHTML = `<button class="hover:text-[#F2B705]">${c.category}</button>`;
      li.querySelector("button").addEventListener("click", () => runSearch("", c.category));
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

async function loadAnnouncement() {
  try {
    const res = await fetch(`${API_BASE}/api/announcement`);
    const data = await res.json();
    const bar = document.getElementById("announcement-bar");
    if (data.message) {
      document.getElementById("announcement-text").textContent = data.message;
      bar.classList.remove("hidden");
    } else {
      bar.classList.add("hidden");
    }
  } catch (e) {
    console.error("announcement load failed", e);
  }
}

// ---------------------------------------------------------------
// Document card rendering
// ---------------------------------------------------------------
function docCardHTML(doc) {
  const uploadDate = new Date(doc.upload_date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const premiumBadge = doc.is_premium
    ? `<span class="text-[10px] font-bold bg-[#F2B705] text-[#0B1E3D] px-2 py-1 rounded">⭐ Premium · ₹${doc.file_price_inr}</span>`
    : "";
  return `
    <div class="doc-card p-5 flex flex-col">
      <div class="flex items-start justify-between mb-2 gap-2">
        <span class="text-[10px] font-mono uppercase tracking-wide bg-[#F6F5F1] text-[#5A6478] px-2 py-1 rounded">${doc.category}</span>
        ${premiumBadge}
        <span class="text-[10px] font-mono text-[#B7BECF] ml-auto">#${doc.doc_id}</span>
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
        <button class="preview-btn flex-1 h-9 rounded-md border border-[#0B1E3D] text-[#0B1E3D] text-xs font-semibold hover:bg-[#0B1E3D] hover:text-white transition-colors" data-id="${doc.doc_id}" data-title="${doc.title}" data-category="${doc.category}" data-premium="${!!doc.is_premium}" data-fileprice="${doc.file_price_inr || ""}">Preview</button>
        <button class="download-btn flex-1 h-9 rounded-md bg-[#F2B705] hover:bg-[#e0a900] text-[#0B1E3D] text-xs font-semibold transition-colors" data-id="${doc.doc_id}" data-title="${doc.title}" data-category="${doc.category}" data-premium="${!!doc.is_premium}" data-fileprice="${doc.file_price_inr || ""}">Download</button>
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
    btn.addEventListener("click", () => openPreview(btn.dataset.id, btn.dataset.title, btn.dataset.category, btn.dataset.premium === "true", btn.dataset.fileprice));
  });
  container.querySelectorAll(".download-btn").forEach(btn => {
    btn.addEventListener("click", () => attemptDownload(btn.dataset.id, btn.dataset.title, btn.dataset.category, btn.dataset.premium === "true", btn.dataset.fileprice));
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
async function openPreview(docId, title, category, isPremium = false, filePrice = "") {
  if (adminCode) {
    // Owner is unlocked — skip identifier prompt and subscription check entirely.
    return renderPreview(docId, title);
  }

  if (!currentUserIdentifier) {
    currentUserIdentifier = (await askForEmail()) || "";
    if (!currentUserIdentifier) return;
    localStorage.setItem("vidyalay_identifier", currentUserIdentifier);
  }

  // Preview is payment-gated per category (or per-file if premium) — check first.
  try {
    const statusRes = await fetch(`${API_BASE}/api/subscription-status?identifier=${encodeURIComponent(currentUserIdentifier)}&category=${encodeURIComponent(category)}&doc_id=${encodeURIComponent(docId)}`);
    const status = await statusRes.json();
    if (!status.active) {
      openPaymentModal(docId, title, category, isPremium, filePrice);
      return;
    }
  } catch (e) {
    console.error("subscription check failed", e);
    showToast("Could not verify subscription — try again", true);
    return;
  }

  await renderPreview(docId, title, category, isPremium, filePrice);
}

async function renderPreview(docId, title, category, isPremium = false, filePrice = "") {
  currentPreviewDocId = docId;
  currentPreviewTitle = title || "";
  currentPreviewCategory = category || "";
  currentPreviewIsPremium = isPremium;
  currentPreviewFilePrice = filePrice;
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
  if (currentPreviewDocId) attemptDownload(currentPreviewDocId, currentPreviewTitle, currentPreviewCategory, currentPreviewIsPremium, currentPreviewFilePrice);
});

// ---------------------------------------------------------------
// Download flow (payment-gated)
// ---------------------------------------------------------------
async function attemptDownload(docId, title, category, isPremium = false, filePrice = "") {
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
    currentUserIdentifier = (await askForEmail()) || "";
    if (!currentUserIdentifier) return;
    localStorage.setItem("vidyalay_identifier", currentUserIdentifier);
  }

  try {
    const statusRes = await fetch(`${API_BASE}/api/subscription-status?identifier=${encodeURIComponent(currentUserIdentifier)}&category=${encodeURIComponent(category)}&doc_id=${encodeURIComponent(docId)}`);
    const status = await statusRes.json();

    if (!status.active) {
      openPaymentModal(docId, title, category, isPremium, filePrice);
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
let paymentSelectedPlan = "monthly"; // "full" | "file" | "monthly"
let paymentFullPrice = null;
let paymentFilePrice = null;

function openPaymentModal(docId, title, category, isPremium = false, filePrice = "") {
  paymentDocId = docId || null;
  paymentDocTitle = title || null;
  paymentDocCategory = category || null;

  const course = allCourses.find(c => c.category === category) || {};
  paymentFullPrice = course.full_course_price || null;
  paymentFilePrice = isPremium && filePrice ? Number(filePrice) : null;
  paymentMonthlyFee = course.monthly_price || paymentMonthlyFee;

  document.getElementById("payment-email-input").value = currentUserIdentifier || "";

  const selectedBox = document.getElementById("payment-selected-doc");
  const selectedTitleEl = document.getElementById("payment-selected-doc-title");
  if (paymentDocTitle) {
    selectedTitleEl.textContent = paymentDocCategory ? `${paymentDocTitle} (${paymentDocCategory})` : paymentDocTitle;
    selectedBox.classList.remove("hidden");
  } else {
    selectedBox.classList.add("hidden");
  }

  // Full Course option
  const fullBtn = document.getElementById("plan-full-price").closest(".payment-plan-btn");
  if (paymentFullPrice) {
    fullBtn.classList.remove("hidden");
    document.getElementById("plan-full-price").textContent = `₹${paymentFullPrice}`;
  } else {
    fullBtn.classList.add("hidden");
  }

  // Single File option — only for a premium file with its own price
  const fileBtn = document.getElementById("plan-file-price").closest(".payment-plan-btn");
  if (paymentFilePrice) {
    fileBtn.classList.remove("hidden");
    document.getElementById("plan-file-price").textContent = `₹${paymentFilePrice}`;
  } else {
    fileBtn.classList.add("hidden");
  }

  // Monthly is always available
  document.getElementById("plan-monthly-price").textContent = `₹${paymentMonthlyFee}`;

  // Default selection: file if this is a premium file, else monthly
  selectPaymentPlan(paymentFilePrice ? "file" : "monthly");

  const modal = document.getElementById("payment-modal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
}

function selectPaymentPlan(plan) {
  paymentSelectedPlan = plan;
  document.querySelectorAll(".payment-plan-btn").forEach(btn => {
    const active = btn.dataset.plan === plan;
    btn.classList.toggle("border-[#F2B705]", active);
    btn.classList.toggle("bg-[#FDF6E3]", active);
    btn.classList.toggle("border-[#EAE7DD]", !active);
  });
}
document.querySelectorAll(".payment-plan-btn").forEach(btn => {
  btn.addEventListener("click", () => selectPaymentPlan(btn.dataset.plan));
});

document.getElementById("payment-close-btn").addEventListener("click", closePaymentModal);
function closePaymentModal() {
  document.getElementById("payment-modal").classList.add("hidden");
  document.getElementById("payment-modal").classList.remove("flex");
}

function currentPlanAmount() {
  if (paymentSelectedPlan === "full") return paymentFullPrice || paymentMonthlyFee;
  if (paymentSelectedPlan === "file") return paymentFilePrice || paymentMonthlyFee;
  return paymentMonthlyFee;
}

function currentPlanLabel() {
  if (paymentSelectedPlan === "full") return "Full Course (permanent, incl. premium files)";
  if (paymentSelectedPlan === "file") return "Single File Only";
  return "Monthly Subscription (30 days)";
}

// "Continue on WhatsApp" — logs the order intent, then opens a WhatsApp chat
// with the owner's number and a pre-filled English message describing the
// selected plan, document, and the amount. WhatsApp links can't attach an
// image automatically, so the message asks the user to attach their
// payment screenshot themselves before sending.
document.getElementById("payment-continue-btn").addEventListener("click", async () => {
  const email = document.getElementById("payment-email-input").value.trim();
  if (!email) {
    showToast("Please enter your email first", true);
    return;
  }
  currentUserIdentifier = email;
  localStorage.setItem("vidyalay_identifier", email);

  const amount = currentPlanAmount();
  const planLabel = currentPlanLabel();

  // Log the order intent in the background so the owner also sees it via /stats.
  try {
    await fetch(`${API_BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        doc_id: paymentDocId,
        category: paymentDocCategory,
        amount_inr: amount,
        note: `Plan: ${planLabel}`,
      }),
    });
  } catch (e) {
    console.error("order logging failed", e);
    // Non-blocking — still continue to WhatsApp even if this fails.
  }

  const itemLine = paymentDocTitle
    ? `Item: ${paymentDocTitle}${paymentDocId ? " (ID: " + paymentDocId + ")" : ""}${paymentDocCategory ? "\nCategory: " + paymentDocCategory : ""}`
    : `Category: ${paymentDocCategory || "—"}`;

  const message =
    `Hello, I would like to unlock access on Vidyalay Coaching Centre Study Portal.\n\n` +
    `Plan: ${planLabel}\n` +
    `${itemLine}\n` +
    `Amount paid: Rs. ${amount}\n` +
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

function hexToRgba(hex, alpha = 0.5) {
  const n = hex.replace("#", "");
  const r = parseInt(n.substring(0, 2), 16);
  const g = parseInt(n.substring(2, 4), 16);
  const b = parseInt(n.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  document.documentElement.style.setProperty("--accent-glow", hexToRgba(hex, 0.5));
  if (save) localStorage.setItem("vidyalay_theme_color", hex);
}

// ---------------------------------------------------------------
// Dark Neon mode
// ---------------------------------------------------------------
function ensureDarkModeStyles() {
  if (document.getElementById("dark-mode-override-style")) return;
  const styleTag = document.createElement("style");
  styleTag.id = "dark-mode-override-style";
  styleTag.textContent = `
    /* Surfaces */
    .dark-mode .bg-\\[\\#F6F5F1\\] { background-color: #0b0b14 !important; }
    .dark-mode .bg-white { background-color: #16161f !important; }
    .dark-mode .bg-\\[\\#EAE7DD\\] { background-color: #0f0f18 !important; }
    .dark-mode .bg-\\[\\#FDF6E3\\] { background-color: #241f0a !important; }

    /* Borders */
    .dark-mode .border-\\[\\#EAE7DD\\] { border-color: #2a2a3d !important; }
    .dark-mode .border-\\[\\#DCD8CB\\] { border-color: #33334a !important; }
    .dark-mode .border-\\[\\#0B1E3D\\] { border-color: #E9ECFF !important; }

    /* Body / surface text -> white, so nothing goes dark-on-dark */
    .dark-mode .text-\\[\\#0B1E3D\\] { color: #F5F7FF !important; }
    .dark-mode .text-\\[\\#5A6478\\] { color: #B7C0DC !important; }
    .dark-mode .text-\\[\\#8B93A7\\] { color: #9BA4C7 !important; }
    .dark-mode .text-\\[\\#8B7A2F\\] { color: #E8CE7A !important; }
    .dark-mode .placeholder\\:text-\\[\\#8B93A7\\]::placeholder { color: #6E7796 !important; }

    /* Exception: text sitting ON the yellow accent background must stay
       dark navy for readability — this rule is more specific so it wins
       over the broad white-text rule above. */
    .dark-mode .bg-\\[\\#F2B705\\].text-\\[\\#0B1E3D\\] { color: #0B1E3D !important; }

    /* Neon glow on accent-coloured buttons */
    .dark-mode .bg-\\[\\#F2B705\\] { box-shadow: 0 0 18px 0 var(--accent-glow, rgba(242,183,5,0.45)); }
  `;
  document.head.appendChild(styleTag);
}

function applyDarkMode(enabled, save = true) {
  ensureDarkModeStyles();
  document.documentElement.classList.toggle("dark-mode", enabled);
  if (save) localStorage.setItem("vidyalay_dark_mode", enabled ? "1" : "0");

  const lightBtn = document.getElementById("mode-light-btn");
  const darkBtn = document.getElementById("mode-dark-btn");
  if (lightBtn && darkBtn) {
    lightBtn.className = `flex-1 h-10 rounded-md text-sm font-semibold border ${!enabled ? "bg-[#0B1E3D] text-white border-[#0B1E3D]" : "border-[#DCD8CB] text-[#0B1E3D]"}`;
    darkBtn.className = `flex-1 h-10 rounded-md text-sm font-semibold border ${enabled ? "bg-[#0B1E3D] text-white border-[#0B1E3D]" : "border-[#DCD8CB] text-[#0B1E3D]"}`;
  }
}

document.getElementById("mode-light-btn").addEventListener("click", () => applyDarkMode(false));
document.getElementById("mode-dark-btn").addEventListener("click", () => applyDarkMode(true));

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
loadAnnouncement();
applyThemeColor(localStorage.getItem("vidyalay_theme_color") || THEME_COLORS[0].hex, false);
applyDarkMode(localStorage.getItem("vidyalay_dark_mode") === "1", false);
  
