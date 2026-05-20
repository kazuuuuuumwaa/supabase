const SUPABASE_URL = "https://zwcgrcvgafwgpvnenkbj.supabase.co";
const SUPABASE_KEY = "sb_publishable_p5mwf4IaC-7v2uxdWbNjhA_9pNcfeEu";
 
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
 
// ─── Chart colour palette (mapped to category color names) ─────────────────
const CHART_PALETTE = {
  pink:     "rgba(244, 114, 182, 0.85)",
  blue:     "rgba(96,  165, 250, 0.85)",
  lavender: "rgba(167, 139, 250, 0.85)",
  yellow:   "rgba(251, 191,  36, 0.85)",
  mint:     "rgba(52,  211, 153, 0.85)",
  sky:      "rgba(56,  189, 248, 0.85)",
  gray:     "rgba(156, 163, 175, 0.85)"
};
 
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
 
// ─── App state ──────────────────────────────────────────────────────────────
let state = {
  currentUser: null,
  expenses:    [],
  categories:  [],
  settings: {
    currency: "PHP",
    budgets: { weekly: 0, monthly: 0, yearly: 0 }
  }
};
 
// Chart instance store (destroy before re-render)
const charts = { today: null, month: null, year: null };
 
// ─── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  setupAuthTabs();
  setupAuthForms();
  setupNavigation();
  setupExpenseForm();
  setupSettings();
  setupLogout();
  setupChartTabs();
  setupAllocTabs();
  setupUserCategories();
  setTodayDate();
 
  const { data } = await supabaseClient.auth.getSession();
  if (data.session?.user) {
    await handleAuthenticatedUser(data.session.user);
  } else {
    showAuth();
  }
 
  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    if (session?.user) {
      await handleAuthenticatedUser(session.user);
    } else {
      state.currentUser = null;
      showAuth();
    }
  });
});
 
async function handleAuthenticatedUser(user) {
  state.currentUser = {
    id:    user.id,
    name:  user.user_metadata?.name || user.user_metadata?.full_name || user.email?.split("@")[0] || "User",
    email: user.email
  };
  await ensureProfileAndDefaults();
  await loadUserData();
  showApp();
}
 
// ─── AUTH ────────────────────────────────────────────────────────────────────
function setupAuthTabs() {
  document.getElementById("loginTabBtn").addEventListener("click",    () => switchAuthTab("login"));
  document.getElementById("registerTabBtn").addEventListener("click", () => switchAuthTab("register"));
}
 
function switchAuthTab(tab) {
  const loginForm     = document.getElementById("loginForm");
  const registerForm  = document.getElementById("registerForm");
  const loginTabBtn   = document.getElementById("loginTabBtn");
  const registerTabBtn= document.getElementById("registerTabBtn");
  const authMessage   = document.getElementById("authMessage");
  authMessage.textContent = "";
 
  if (tab === "login") {
    loginForm.classList.remove("hidden");
    registerForm.classList.add("hidden");
    loginTabBtn.classList.add("active");
    registerTabBtn.classList.remove("active");
  } else {
    registerForm.classList.remove("hidden");
    loginForm.classList.add("hidden");
    registerTabBtn.classList.add("active");
    loginTabBtn.classList.remove("active");
  }
}
 
function setupAuthForms() {
  document.getElementById("loginForm").addEventListener("submit",    handleLogin);
  document.getElementById("registerForm").addEventListener("submit", handleRegister);
}
 
async function handleRegister(event) {
  event.preventDefault();
  const name            = document.getElementById("registerName").value.trim();
  const email           = document.getElementById("registerEmail").value.trim().toLowerCase();
  const password        = document.getElementById("registerPassword").value;
  const confirmPassword = document.getElementById("registerConfirmPassword").value;
  const authMessage     = document.getElementById("authMessage");
  authMessage.style.color = "#dc2626";
 
  if (!name || !email || !password || !confirmPassword) { authMessage.textContent = "Please complete all fields."; return; }
  if (password.length < 6) { authMessage.textContent = "Password must be at least 6 characters."; return; }
  if (password !== confirmPassword) { authMessage.textContent = "Passwords do not match."; return; }
 
  const { error } = await supabaseClient.auth.signUp({ email, password, options: { data: { name } } });
  if (error) { authMessage.textContent = error.message; return; }
 
  authMessage.style.color = "#16a34a";
  authMessage.textContent = "Account created! You can now sign in.";
  document.getElementById("registerForm").reset();
  switchAuthTab("login");
}
 
async function handleLogin(event) {
  event.preventDefault();
  const email       = document.getElementById("loginEmail").value.trim().toLowerCase();
  const password    = document.getElementById("loginPassword").value;
  const authMessage = document.getElementById("authMessage");
  authMessage.style.color = "#dc2626";
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) authMessage.textContent = error.message;
}
 
function setupLogout() {
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
  });
}
 
// ─── VISIBILITY ─────────────────────────────────────────────────────────────
function showAuth() {
  document.getElementById("authScreen").classList.remove("hidden");
  document.getElementById("appShell").classList.add("hidden");
}
 
function showApp() {
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appShell").classList.remove("hidden");
  document.getElementById("welcomeText").textContent = `Welcome, ${state.currentUser.name}!`;
  renderAll();
}
 
// ─── DATABASE ────────────────────────────────────────────────────────────────
async function ensureProfileAndDefaults() {
  // Upsert profile
  await supabaseClient.from("profiles").upsert({
    id:    state.currentUser.id,
    name:  state.currentUser.name,
    email: state.currentUser.email
  });
 
  // Ensure user_settings row exists
  const settingsRes = await supabaseClient
    .from("user_settings")
    .select("*")
    .eq("user_id", state.currentUser.id)
    .maybeSingle();
 
  if (!settingsRes.data) {
    await supabaseClient.from("user_settings").insert({
      user_id:        state.currentUser.id,
      currency:       "PHP",
      weekly_budget:  0,
      monthly_budget: 0,
      yearly_budget:  0
    });
  }
  // NOTE: Categories are now global — no per-user category seeding needed.
}
 
async function loadUserData() {
  // Fetch global categories (user_id IS NULL) + user's own categories
  // RLS policy handles this: select is allowed for (user_id is null OR user_id = auth.uid())
  const categoriesResponse = await supabaseClient
    .from("categories")
    .select("*")
    .order("created_at", { ascending: true });
 
  const expensesResponse = await supabaseClient
    .from("expenses")
    .select("*")
    .eq("user_id", state.currentUser.id)
    .order("expense_date", { ascending: false });
 
  const settingsResponse = await supabaseClient
    .from("user_settings")
    .select("*")
    .eq("user_id", state.currentUser.id)
    .maybeSingle();
 
  if (categoriesResponse.error) { console.error(categoriesResponse.error); alert(categoriesResponse.error.message); }
  if (expensesResponse.error)   { console.error(expensesResponse.error);   alert(expensesResponse.error.message); }
  if (settingsResponse.error)   { console.error(settingsResponse.error);   alert(settingsResponse.error.message); }
 
  state.categories = categoriesResponse.data || [];
 
  state.expenses = (expensesResponse.data || []).map((expense) => {
    const category = state.categories.find((cat) => cat.id === expense.category_id);
    return {
      id:            expense.id,
      amount:        Number(expense.amount),
      description:   expense.description,
      date:          expense.expense_date,
      categoryId:    expense.category_id,
      categoryName:  category?.name  || "Unknown",
      categoryIcon:  category?.icon  || "📦",
      categoryColor: category?.color || "gray"
    };
  });
 
  const settings = settingsResponse.data || null;
  state.settings = {
    currency: settings?.currency || "PHP",
    budgets: {
      weekly:  Number(settings?.weekly_budget  || 0),
      monthly: Number(settings?.monthly_budget || 0),
      yearly:  Number(settings?.yearly_budget  || 0)
    }
  };
}
 
// ─── NAVIGATION ──────────────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => showPage(item.dataset.page));
  });
}
 
function showPage(pageId) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === pageId);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === pageId);
  });
}
 
// ─── EXPENSE FORM ────────────────────────────────────────────────────────────
function setupExpenseForm() {
  document.getElementById("expenseForm").addEventListener("submit", handleAddExpense);
  document.getElementById("cancelExpenseBtn").addEventListener("click", () => setTodayDate());
}
 
async function handleAddExpense(event) {
  event.preventDefault();
  const amount      = parseFloat(document.getElementById("amount").value);
  const categoryId  = document.getElementById("categorySelect").value;
  const description = document.getElementById("description").value.trim();
  const expenseDate = document.getElementById("expenseDate").value;
 
  if (!amount || amount <= 0) { alert("Please enter a valid amount."); return; }
  if (!categoryId)            { alert("Please select a category.");    return; }
  if (!description)           { alert("Please enter a description."); return; }
 
  const { error } = await supabaseClient.from("expenses").insert({
    user_id:      state.currentUser.id,
    user_email:   state.currentUser.email,
    amount,
    description,
    expense_date: expenseDate,
    category_id:  categoryId
  });
 
  if (error) { console.error("Add expense error:", error); alert(error.message); return; }
 
  event.target.reset();
  setTodayDate();
  await loadUserData();
  renderAll();
  showPage("all-expenses");
}
 
async function deleteExpense(id) {
  if (!window.confirm("Delete this expense?")) return;
  const { error } = await supabaseClient
    .from("expenses").delete()
    .eq("id", id)
    .eq("user_id", state.currentUser.id);
  if (error) { console.error(error); alert(error.message); return; }
  await loadUserData();
  renderAll();
}
 
// ─── SETTINGS ────────────────────────────────────────────────────────────────
function setupSettings() {
  const budgetForm = document.getElementById("budgetForm");
  if (budgetForm) budgetForm.addEventListener("submit", handleSaveBudgetSettings);
  setupBudgetCascade();
}
 
// ── Budget cascade: yearly → monthly+weekly | monthly → weekly | weekly → nothing
function setupBudgetCascade() {
  const yearlyEl  = document.getElementById("yearlyBudgetInput");
  const monthlyEl = document.getElementById("monthlyBudgetInput");
  const weeklyEl  = document.getElementById("weeklyBudgetInput");
 
  if (!yearlyEl || !monthlyEl || !weeklyEl) return;
 
  // YEARLY typed → cascade down to monthly & weekly
  yearlyEl.addEventListener("input", () => {
    const yearly = parseFloat(yearlyEl.value) || 0;
 
    if (yearly > 0) {
      const monthly = +(yearly / 12).toFixed(2);
      const weekly  = +(yearly / 52).toFixed(2);
 
      monthlyEl.value = monthly;
      weeklyEl.value  = weekly;
 
      setAutoField("monthly", true,  `Auto: ₱${yearly.toLocaleString()} ÷ 12 months`);
      setAutoField("weekly",  true,  `Auto: ₱${yearly.toLocaleString()} ÷ 52 weeks`);
      setHint("yearlyHint", `→ Monthly: ${formatCurrency(monthly)}  ·  Weekly: ${formatCurrency(weekly)}`);
    } else {
      // Yearly cleared — reset cascaded fields
      monthlyEl.value = 0;
      weeklyEl.value  = 0;
      setAutoField("monthly", false, "");
      setAutoField("weekly",  false, "");
      setHint("yearlyHint", "");
    }
  });
 
  // MONTHLY typed → cascade down to weekly only (yearly stays untouched)
  monthlyEl.addEventListener("input", () => {
    // Only cascade if yearly is not driving things
    const yearly  = parseFloat(yearlyEl.value) || 0;
    if (yearly > 0) return;  // yearly is master, skip
 
    const monthly = parseFloat(monthlyEl.value) || 0;
 
    if (monthly > 0) {
      const weekly = +(monthly / 4.3333).toFixed(2);
      weeklyEl.value = weekly;
      setAutoField("weekly", true,  `Auto: ₱${monthly.toLocaleString()} ÷ 4.33 weeks`);
      setHint("monthlyHint", `→ Weekly: ${formatCurrency(weekly)}`);
    } else {
      weeklyEl.value = 0;
      setAutoField("weekly", false, "");
      setHint("monthlyHint", "");
    }
  });
 
  // WEEKLY typed → no cascade; clear its own auto state
  weeklyEl.addEventListener("input", () => {
    const yearly  = parseFloat(yearlyEl.value)  || 0;
    const monthly = parseFloat(monthlyEl.value) || 0;
    // If neither yearly nor monthly is driving weekly, remove auto badge
    if (!yearly && !monthly) {
      setAutoField("weekly", false, "");
      setHint("weeklyHint", "Monthly & Yearly remain unchanged.");
    }
  });
}
 
// Helper: toggle auto-badge + input styling
function setAutoField(period, isAuto, hintText) {
  const badge = document.getElementById(`${period}AutoBadge`);
  const field = document.getElementById(`${period}BudgetField`);
  const input = document.getElementById(`${period}BudgetInput`);
  const hint  = document.getElementById(`${period}Hint`);
 
  if (badge) badge.classList.toggle("hidden", !isAuto);
  if (field) field.classList.toggle("is-auto", isAuto);
  if (input) input.classList.toggle("input-auto", isAuto);
  if (hint)  hint.textContent = hintText || "";
}
 
function setHint(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
 
async function handleSaveBudgetSettings(event) {
  event.preventDefault();
  const currency = document.getElementById("currencyInput").value.trim().toUpperCase();
  const weekly   = parseFloat(document.getElementById("weeklyBudgetInput").value  || "0");
  const monthly  = parseFloat(document.getElementById("monthlyBudgetInput").value || "0");
  const yearly   = parseFloat(document.getElementById("yearlyBudgetInput").value  || "0");
 
  if (!currency || currency.length !== 3) {
    showBudgetMsg("Currency must be exactly 3 letters, e.g. PHP.", "error");
    return;
  }
  if (weekly < 0 || monthly < 0 || yearly < 0) {
    showBudgetMsg("Budgets cannot be negative.", "error");
    return;
  }
 
  const { error } = await supabaseClient.from("user_settings").upsert({
    user_id:        state.currentUser.id,
    currency,
    weekly_budget:  weekly,
    monthly_budget: monthly,
    yearly_budget:  yearly
  });
 
  if (error) {
    console.error("Save settings error:", error);
    showBudgetMsg(error.message, "error");
    return;
  }
 
  await loadUserData();
  renderAll();
  showBudgetMsg("✅ Budget settings saved successfully!", "success");
}
 
// Inline save message (replaces browser alert)
function showBudgetMsg(text, type) {
  const el = document.getElementById("budgetSaveMsg");
  if (!el) return;
  el.textContent = text;
  el.className   = `budget-save-msg ${type}`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}
 
// ─── CHART TABS ──────────────────────────────────────────────────────────────
function setupChartTabs() {
  document.querySelectorAll(".chart-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      document.querySelectorAll(".chart-tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".chart-view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      const panelId = `chartView${view.charAt(0).toUpperCase() + view.slice(1)}`;
      document.getElementById(panelId)?.classList.add("active");
    });
  });
}
 
// ─── RENDER ALL ──────────────────────────────────────────────────────────────
function renderAll() {
  renderCategorySelect();
  renderSettingsCategories();
  renderUserCategories();
  renderDashboard();
  renderExpensesList();
  fillSettingsForm();
  renderBudgetOverview();
  renderCategoryBudgetAllocation();
  renderCharts();
}
 
// ─── CATEGORY SELECT ─────────────────────────────────────────────────────────
function renderCategorySelect() {
  const select = document.getElementById("categorySelect");
  select.innerHTML = `<option value="">Select category</option>`;
  state.categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = `${category.icon} ${category.name}`;
    select.appendChild(option);
  });
}
 
// ─── SETTINGS CATEGORIES — admin global (read-only) ─────────────────────────
function renderSettingsCategories() {
  const container = document.getElementById("settingsCategoryGrid");
  container.innerHTML = "";
 
  // Only global/admin categories (user_id is null)
  const adminCats = state.categories.filter((c) => !c.user_id);
 
  if (!adminCats.length) {
    container.innerHTML = `<div class="empty-state"><p>No default categories found.</p></div>`;
    return;
  }
 
  adminCats.forEach((category) => {
    // locked field is now dynamic — admin can toggle it in Table Editor
    const lockBadge = category.locked
      ? `<span class="lock-badge">🔒 Locked</span>`
      : `<span class="unlock-badge">🔓 Unlocked</span>`;
 
    const item = document.createElement("div");
    item.className = `settings-category-item${!category.locked ? " default-cat-unlocked" : ""}`;
    item.innerHTML = `
      <div class="settings-left">
        <div class="icon-circle ${category.color || "gray"}">${category.icon}</div>
        <div class="user-cat-info">
          <span>${escapeHtml(category.name)}</span>
          <small class="cat-admin-note">Admin default · visible to all users</small>
        </div>
      </div>
      ${lockBadge}
    `;
    container.appendChild(item);
  });
}
 
// ─── USER CUSTOM CATEGORIES ──────────────────────────────────────────────────
function setupUserCategories() {
  const form = document.getElementById("addUserCategoryForm");
  if (form) form.addEventListener("submit", handleAddUserCategory);
}
 
function renderUserCategories() {
  const container  = document.getElementById("userCategoryGrid");
  const countBadge = document.getElementById("userCatCount");
  if (!container) return;
 
  // Only the current user's own categories
  const userCats = state.categories.filter(
    (c) => c.user_id && c.user_id === state.currentUser.id
  );
 
  if (countBadge) countBadge.textContent = `${userCats.length} custom`;
 
  container.innerHTML = "";
 
  if (!userCats.length) {
    container.innerHTML = `<div class="empty-state"><p>No custom categories yet. Add one above!</p></div>`;
    return;
  }
 
  userCats.forEach((category) => {
    const isUsed       = state.expenses.some((e) => e.categoryId === category.id);
    const adminLocked  = category.locked === true;   // admin toggled this in Table Editor
    const cantDelete   = isUsed || adminLocked;
 
    // Decide status badge/note
    let statusNote = "";
    if (adminLocked) {
      statusNote = `<span class="cat-admin-lock-badge">🔒 Admin Locked</span>`;
    } else if (isUsed) {
      statusNote = `<small class="cat-in-use-note">In use — cannot delete</small>`;
    }
 
    // Delete button disabled reason
    let disabledAttr  = "";
    let disabledStyle = "";
    let disabledTitle = "";
    if (adminLocked) {
      disabledAttr  = "disabled";
      disabledStyle = "opacity:0.35;cursor:not-allowed;";
      disabledTitle = `title="Locked by admin — contact your admin to unlock"`;
    } else if (isUsed) {
      disabledAttr  = "disabled";
      disabledStyle = "opacity:0.35;cursor:not-allowed;";
      disabledTitle = `title="This category is linked to an expense"`;
    }
 
    const item = document.createElement("div");
    item.className = `settings-category-item${adminLocked ? " cat-item-locked" : ""}`;
    item.innerHTML = `
      <div class="settings-left">
        <div class="icon-circle ${category.color || "gray"}">${category.icon}</div>
        <div class="user-cat-info">
          <span>${escapeHtml(category.name)}</span>
          ${statusNote}
        </div>
      </div>
      <button
        class="delete-btn user-cat-delete-btn"
        type="button"
        ${disabledAttr}
        ${disabledTitle}
        style="${disabledStyle}"
      >🗑 Delete</button>
    `;
 
    if (!cantDelete) {
      item.querySelector(".user-cat-delete-btn")
          .addEventListener("click", () => handleDeleteUserCategory(category.id, category.name));
    }
 
    container.appendChild(item);
  });
}
 
async function handleAddUserCategory(event) {
  event.preventDefault();
 
  const name  = document.getElementById("newCategoryName").value.trim();
  const icon  = document.getElementById("newCategoryIcon").value.trim() || "🏷";
  const color = document.getElementById("newCategoryColor").value || "gray";
 
  if (!name) {
    showUserCatMsg("Please enter a category name.", "error");
    return;
  }
 
  // Check for duplicate name among all categories visible to this user
  const duplicate = state.categories.some(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    showUserCatMsg(`A category named "${name}" already exists.`, "error");
    return;
  }
 
  const { error } = await supabaseClient.from("categories").insert({
    user_id:    state.currentUser.id,
    user_email: state.currentUser.email,   // stored so admin can see who owns it
    name,
    icon,
    color,
    locked: false
  });
 
  if (error) {
    console.error("Add user category error:", error);
    // Friendly duplicate error
    const msg = error.message?.toLowerCase() || "";
    if (msg.includes("duplicate") || msg.includes("unique")) {
      showUserCatMsg(`A category named "${name}" already exists.`, "error");
    } else {
      showUserCatMsg(error.message, "error");
    }
    return;
  }
 
  document.getElementById("addUserCategoryForm").reset();
  await loadUserData();
  renderAll();
  showUserCatMsg(`✅ Category "${name}" added successfully!`, "success");
}
 
async function handleDeleteUserCategory(id, name) {
  if (!window.confirm(`Delete the category "${name}"? This cannot be undone.`)) return;
 
  const { error } = await supabaseClient
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("user_id", state.currentUser.id);   // safety: only own rows
 
  if (error) {
    console.error("Delete user category error:", error);
    showUserCatMsg(error.message, "error");
    return;
  }
 
  await loadUserData();
  renderAll();
  showUserCatMsg(`🗑 Category "${name}" deleted.`, "success");
}
 
function showUserCatMsg(text, type) {
  const el = document.getElementById("userCatMsg");
  if (!el) return;
  el.textContent = text;
  el.className   = `user-cat-msg ${type}`;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 4000);
}
 
// ─── DASHBOARD ───────────────────────────────────────────────────────────────
function renderDashboard() {
  const total      = sumExpenses(state.expenses);
  const monthTotal = sumExpenses(getCurrentMonthExpenses());
 
  document.getElementById("dashboardTotal").textContent      = formatCurrency(total);
  document.getElementById("dashboardMonthTotal").textContent = formatCurrency(monthTotal);
  document.getElementById("dashboardCount").textContent      = state.expenses.length;
 
  const container = document.getElementById("recentExpensesContainer");
  container.innerHTML = "";
 
  if (!state.expenses.length) {
    container.innerHTML = `<div class="empty-state"><p>No expenses yet</p></div>`;
    return;
  }
 
  state.expenses.slice(0, 5).forEach((expense) => {
    const item = document.createElement("div");
    item.className = "simple-list-item";
    item.innerHTML = `
      <div class="simple-list-left">
        <div class="icon-circle ${expense.categoryColor || "gray"}">${expense.categoryIcon}</div>
        <div>
          <strong>${escapeHtml(expense.description)}</strong>
          <p>${escapeHtml(expense.categoryName)} • ${formatDisplayDate(expense.date)}</p>
        </div>
      </div>
      <strong>${formatCurrency(expense.amount)}</strong>
    `;
    container.appendChild(item);
  });
}
 
// ─── EXPENSES LIST ───────────────────────────────────────────────────────────
function renderExpensesList() {
  const expensesList = document.getElementById("expensesList");
  expensesList.innerHTML = "";
 
  document.getElementById("allExpenseCount").textContent =
    `${state.expenses.length} transaction${state.expenses.length === 1 ? "" : "s"}`;
  document.getElementById("allExpenseTotal").textContent = formatCurrency(sumExpenses(state.expenses));
 
  if (!state.expenses.length) {
    expensesList.innerHTML = `<div class="empty-state"><p>No expenses yet</p></div>`;
    return;
  }
 
  state.expenses.forEach((expense) => {
    const item = document.createElement("div");
    item.className = "expense-item";
    item.innerHTML = `
      <div class="expense-left">
        <div class="icon-circle ${expense.categoryColor || "gray"}">${expense.categoryIcon}</div>
        <div class="expense-details">
          <h4>${escapeHtml(expense.description)}</h4>
          <p>${escapeHtml(expense.categoryName)} • ${formatDisplayDate(expense.date)}</p>
          <small class="user-badge">${escapeHtml(state.currentUser.email)}</small>
        </div>
      </div>
      <div class="expense-right">
        <div class="expense-amount">${formatCurrency(expense.amount)}</div>
        <button class="delete-btn" type="button">Delete</button>
      </div>
    `;
    item.querySelector(".delete-btn").addEventListener("click", () => deleteExpense(expense.id));
    expensesList.appendChild(item);
  });
}
 
// ─── SETTINGS FORM ───────────────────────────────────────────────────────────
function fillSettingsForm() {
  const c = document.getElementById("currencyInput");
  const w = document.getElementById("weeklyBudgetInput");
  const m = document.getElementById("monthlyBudgetInput");
  const y = document.getElementById("yearlyBudgetInput");
  if (!c) return;
 
  const currency = state.settings.currency || "PHP";
  const weekly   = Number(state.settings.budgets.weekly  || 0);
  const monthly  = Number(state.settings.budgets.monthly || 0);
  const yearly   = Number(state.settings.budgets.yearly  || 0);
 
  c.value = currency;
  w.value = weekly;
  m.value = monthly;
  y.value = yearly;
 
  // Restore cascade visual state based on loaded values
  const yearlyDrivesAll   = yearly > 0 && Math.abs(monthly - yearly / 12) < 0.05 && Math.abs(weekly - yearly / 52) < 0.05;
  const monthlyDrivesWeek = !yearlyDrivesAll && monthly > 0 && Math.abs(weekly - monthly / 4.3333) < 0.05;
 
  if (yearlyDrivesAll) {
    setAutoField("monthly", true, `Auto: ${formatCurrency(yearly)} ÷ 12 months`);
    setAutoField("weekly",  true, `Auto: ${formatCurrency(yearly)} ÷ 52 weeks`);
    setHint("yearlyHint",   `→ Monthly: ${formatCurrency(monthly)}  ·  Weekly: ${formatCurrency(weekly)}`);
  } else if (monthlyDrivesWeek) {
    setAutoField("monthly", false, "");
    setAutoField("weekly",  true, `Auto: ${formatCurrency(monthly)} ÷ 4.33 weeks`);
    setHint("monthlyHint",  `→ Weekly: ${formatCurrency(weekly)}`);
  } else {
    setAutoField("monthly", false, "");
    setAutoField("weekly",  false, "");
    setHint("yearlyHint",   "");
    setHint("monthlyHint",  "");
    setHint("weeklyHint",   "");
  }
}
 
// ─── BUDGET OVERVIEW ─────────────────────────────────────────────────────────
function renderBudgetOverview() {
  const weekSpent  = getCurrentWeekTotal();
  const monthSpent = sumExpenses(getCurrentMonthExpenses());
  const yearSpent  = getCurrentYearTotal();
 
  const wb = Number(state.settings.budgets.weekly  || 0);
  const mb = Number(state.settings.budgets.monthly || 0);
  const yb = Number(state.settings.budgets.yearly  || 0);
 
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
 
  set("weeklyBudgetStatus",  `${formatCurrency(weekSpent)}  / ${formatCurrency(wb)}`);
  set("monthlyBudgetStatus", `${formatCurrency(monthSpent)} / ${formatCurrency(mb)}`);
  set("yearlyBudgetStatus",  `${formatCurrency(yearSpent)}  / ${formatCurrency(yb)}`);
  set("weeklyBudgetHint",    buildBudgetHint(weekSpent,  wb));
  set("monthlyBudgetHint",   buildBudgetHint(monthSpent, mb));
  set("yearlyBudgetHint",    buildBudgetHint(yearSpent,  yb));
}
 
// ═══════════════════════════════════════════════════════════════════════════
// CHARTS
// ═══════════════════════════════════════════════════════════════════════════
 
function renderCharts() {
  renderTodayChart();
  renderMonthChart();
  renderYearChart();
}
 
/* ── Shared: destroy old instance ── */
function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); charts[key] = null; }
}
 
/* ── Shared: show/hide empty state ── */
function setChartEmpty(canvasId, emptyId, isEmpty) {
  const canvas = document.getElementById(canvasId);
  const empty  = document.getElementById(emptyId);
  if (!canvas || !empty) return;
  canvas.style.display = isEmpty ? "none" : "block";
  empty.classList.toggle("hidden", !isEmpty);
}
 
/* ── TODAY: doughnut chart by category ── */
function renderTodayChart() {
  destroyChart("today");
 
  const today        = new Date().toISOString().split("T")[0];
  const todayExpenses = state.expenses.filter((e) => e.date === today);
 
  if (!todayExpenses.length) {
    setChartEmpty("todayChart", "todayEmpty", true);
    document.getElementById("todayLegend").innerHTML = "";
    return;
  }
  setChartEmpty("todayChart", "todayEmpty", false);
 
  // Aggregate by category
  const catMap = {};
  todayExpenses.forEach((e) => {
    if (!catMap[e.categoryName]) {
      catMap[e.categoryName] = { total: 0, color: e.categoryColor, icon: e.categoryIcon };
    }
    catMap[e.categoryName].total += e.amount;
  });
 
  const labels     = Object.keys(catMap);
  const data       = labels.map((l) => catMap[l].total);
  const bgColors   = labels.map((l) => CHART_PALETTE[catMap[l].color] || CHART_PALETTE.gray);
  const totalToday = data.reduce((a, b) => a + b, 0);
 
  const ctx = document.getElementById("todayChart");
  charts.today = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: bgColors,
        borderWidth:     3,
        borderColor:     "#ffffff",
        hoverOffset:     8
      }]
    },
    options: {
      responsive:         true,
      maintainAspectRatio: true,
      cutout:             "65%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatCurrency(ctx.parsed)} (${((ctx.parsed / totalToday) * 100).toFixed(1)}%)`
          }
        }
      }
    }
  });
 
  // Custom legend
  const legend = document.getElementById("todayLegend");
  legend.innerHTML = labels.map((label, i) => `
    <div class="legend-item">
      <span class="legend-dot" style="background:${bgColors[i]}"></span>
      <span class="legend-label">${escapeHtml(label)}</span>
      <span class="legend-value">${formatCurrency(data[i])}</span>
    </div>
  `).join("");
}
 
/* ── MONTH: bar chart — daily totals for current month ── */
function renderMonthChart() {
  destroyChart("month");
 
  const now        = new Date();
  const year       = now.getFullYear();
  const month      = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
 
  const dailyTotals = Array(daysInMonth).fill(0);
  state.expenses.forEach((e) => {
    const d = new Date(`${e.date}T00:00:00`);
    if (d.getFullYear() === year && d.getMonth() === month) {
      dailyTotals[d.getDate() - 1] += e.amount;
    }
  });
 
  const hasData = dailyTotals.some((v) => v > 0);
  if (!hasData) { setChartEmpty("monthChart", "monthEmpty", true); return; }
  setChartEmpty("monthChart", "monthEmpty", false);
 
  const labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
  const ctx    = document.getElementById("monthChart");
 
  charts.month = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label:           "Daily Spending",
        data:            dailyTotals,
        backgroundColor: "rgba(37, 99, 235, 0.75)",
        borderRadius:    6,
        borderSkipped:   false
      }]
    },
    options: {
      responsive:         true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => `Day ${items[0].label}`,
            label: (ctx)   => ` ${formatCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11 } }
        },
        y: {
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: {
            callback: (v) => formatCurrency(v),
            font: { size: 11 }
          }
        }
      }
    }
  });
}
 
/* ── YEAR: bar chart — monthly totals for current year ── */
function renderYearChart() {
  destroyChart("year");
 
  const year         = new Date().getFullYear();
  const monthlyTotals = Array(12).fill(0);
 
  state.expenses.forEach((e) => {
    const d = new Date(`${e.date}T00:00:00`);
    if (d.getFullYear() === year) monthlyTotals[d.getMonth()] += e.amount;
  });
 
  const hasData = monthlyTotals.some((v) => v > 0);
  if (!hasData) { setChartEmpty("yearChart", "yearEmpty", true); return; }
  setChartEmpty("yearChart", "yearEmpty", false);
 
  const ctx = document.getElementById("yearChart");
  charts.year = new Chart(ctx, {
    type: "bar",
    data: {
      labels: MONTH_NAMES,
      datasets: [{
        label:           "Monthly Spending",
        data:            monthlyTotals,
        backgroundColor: monthlyTotals.map((v) =>
          v === Math.max(...monthlyTotals)
            ? "rgba(37, 99, 235, 0.85)"
            : "rgba(37, 99, 235, 0.4)"
        ),
        borderRadius:    8,
        borderSkipped:   false
      }]
    },
    options: {
      responsive:         true,
      maintainAspectRatio: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${formatCurrency(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 12 } } },
        y: {
          grid: { color: "rgba(0,0,0,0.05)" },
          ticks: { callback: (v) => formatCurrency(v), font: { size: 11 } }
        }
      }
    }
  });
}
 
// ─── CATEGORY BUDGET ALLOCATION (NEW) ────────────────────────────────────────
 
function setupAllocTabs() {
  document.querySelectorAll(".alloc-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".alloc-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderCategoryBudgetAllocation();
    });
  });
}
 
function renderCategoryBudgetAllocation() {
  const container = document.getElementById("categoryAllocationList");
  if (!container) return;
 
  const numCats = state.categories.length;
  if (!numCats) {
    container.innerHTML = `<p class="alloc-empty">No categories found.</p>`;
    return;
  }
 
  // Determine active period tab
  const activeTab = document.querySelector(".alloc-tab.active");
  const period    = activeTab?.dataset.period || "monthly";
 
  const budgetMap = {
    weekly:  state.settings.budgets.weekly,
    monthly: state.settings.budgets.monthly,
    yearly:  state.settings.budgets.yearly
  };
 
  const budget = Number(budgetMap[period] || 0);
 
  if (!budget || budget <= 0) {
    container.innerHTML = `<p class="alloc-empty">Set a ${period} budget in Settings → Budget Settings to see per-category allocation.</p>`;
    return;
  }
 
  const perCategory = budget / numCats;
  const pct         = (100 / numCats).toFixed(1);
 
  // Also compute how much each category has actually been spent this period
  const spentMap = {};
  state.categories.forEach((cat) => { spentMap[cat.id] = 0; });
 
  const now = new Date();
 
  state.expenses.forEach((e) => {
    const d = new Date(`${e.date}T00:00:00`);
    let inPeriod = false;
 
    if (period === "weekly") {
      const diff        = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const startOfWeek = new Date(now);
      startOfWeek.setHours(0, 0, 0, 0);
      startOfWeek.setDate(now.getDate() - diff);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);
      inPeriod = d >= startOfWeek && d < endOfWeek;
    } else if (period === "monthly") {
      inPeriod = d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    } else if (period === "yearly") {
      inPeriod = d.getFullYear() === now.getFullYear();
    }
 
    if (inPeriod && spentMap.hasOwnProperty(e.categoryId)) {
      spentMap[e.categoryId] += e.amount;
    }
  });
 
  const periodLabel = { weekly: "this week", monthly: "this month", yearly: "this year" }[period];
 
  container.innerHTML = state.categories.map((cat) => {
    const spent     = spentMap[cat.id] || 0;
    const remaining = perCategory - spent;
    const usedPct   = Math.min((spent / perCategory) * 100, 100);
    const isOver    = spent > perCategory;
 
    const barColor  = isOver
      ? "#ef4444"
      : usedPct > 80
        ? "#f59e0b"
        : "var(--primary)";
 
    const hintText  = isOver
      ? `Over by ${formatCurrency(Math.abs(remaining))}`
      : `${formatCurrency(remaining)} left`;
 
    return `
      <div class="alloc-item">
        <div class="alloc-left">
          <div class="icon-circle ${cat.color || "gray"}">${cat.icon}</div>
          <div class="alloc-meta">
            <span class="alloc-name">${escapeHtml(cat.name)}</span>
            <span class="alloc-hint ${isOver ? "over" : ""}">${hintText} ${periodLabel}</span>
          </div>
        </div>
        <div class="alloc-right">
          <div class="alloc-bar-track">
            <div class="alloc-bar-fill" style="width:${usedPct.toFixed(1)}%; background:${barColor};"></div>
          </div>
          <div class="alloc-numbers">
            <span class="alloc-spent">${formatCurrency(spent)}</span>
            <span class="alloc-sep">/</span>
            <span class="alloc-cap">${formatCurrency(perCategory)}</span>
            <span class="alloc-pct-badge">${pct}%</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}
 
// ─── HELPERS ─────────────────────────────────────────────────────────────────
function setTodayDate() {
  document.getElementById("expenseDate").value = new Date().toISOString().split("T")[0];
}
 
function sumExpenses(expenses) {
  return expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
}
 
function getCurrentMonthExpenses() {
  const now = new Date();
  return state.expenses.filter((e) => {
    const d = new Date(`${e.date}T00:00:00`);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
}
 
function getCurrentWeekTotal() {
  const now = new Date();
  const diff = now.getDay() === 0 ? 6 : now.getDay() - 1;
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - diff);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
 
  return state.expenses.reduce((sum, e) => {
    const d = new Date(`${e.date}T00:00:00`);
    return (d >= startOfWeek && d < endOfWeek) ? sum + Number(e.amount || 0) : sum;
  }, 0);
}
 
function getCurrentYearTotal() {
  const year = new Date().getFullYear();
  return state.expenses.reduce((sum, e) => {
    return new Date(`${e.date}T00:00:00`).getFullYear() === year
      ? sum + Number(e.amount || 0) : sum;
  }, 0);
}
 
function buildBudgetHint(spent, budget) {
  if (!budget || budget <= 0) return "No budget set";
  const rem = budget - spent;
  return rem >= 0
    ? `Remaining: ${formatCurrency(rem)}`
    : `Over budget by ${formatCurrency(Math.abs(rem))}`;
}
 
function formatCurrency(amount) {
  const currency = state.settings?.currency || "PHP";
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency }).format(amount || 0);
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
}
 
function formatDisplayDate(dateString) {
  return new Date(`${dateString}T00:00:00`).toLocaleDateString("en-PH", {
    year: "numeric", month: "short", day: "numeric"
  });
}
 
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}


