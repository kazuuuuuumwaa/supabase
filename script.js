const SUPABASE_URL = "https://zwcgrcvgafwgpvnenkbj.supabase.co";
const SUPABASE_KEY = "sb_publishable_p5mwf4IaC-7v2uxdWbNjhA_9pNcfeEu";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const DEFAULT_CATEGORIES = [
  { name: "Food & Dining", icon: "🍽", color: "pink", locked: true },
  { name: "Transportation", icon: "🚗", color: "blue", locked: true },
  { name: "Shopping", icon: "🛍", color: "lavender", locked: true },
  { name: "Entertainment", icon: "🎬", color: "pink", locked: true },
  { name: "Bills & Utilities", icon: "📄", color: "yellow", locked: true },
  { name: "Healthcare", icon: "💊", color: "mint", locked: true },
  { name: "Travel", icon: "✈", color: "sky", locked: true },
  { name: "Other", icon: "📦", color: "gray", locked: true }
];

let state = {
  currentUser: null,
  expenses: [],
  categories: [],
  settings: {
    currency: "PHP",
    budgets: { weekly: 0, monthly: 0, yearly: 0 }
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  setupAuthTabs();
  setupAuthForms();
  setupNavigation();
  setupExpenseForm();
  setupSettings();
  setupLogout();
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
    id: user.id,
    name:
      user.user_metadata?.name ||
      user.user_metadata?.full_name ||
      user.email?.split("@")[0] ||
      "User",
    email: user.email
  };

  await ensureProfileAndDefaults();
  await loadUserData();
  showApp();
}

/* AUTH */
function setupAuthTabs() {
  document.getElementById("loginTabBtn").addEventListener("click", () => switchAuthTab("login"));
  document.getElementById("registerTabBtn").addEventListener("click", () => switchAuthTab("register"));
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById("loginForm");
  const registerForm = document.getElementById("registerForm");
  const loginTabBtn = document.getElementById("loginTabBtn");
  const registerTabBtn = document.getElementById("registerTabBtn");
  const authMessage = document.getElementById("authMessage");

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
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  document.getElementById("registerForm").addEventListener("submit", handleRegister);
}

async function handleRegister(event) {
  event.preventDefault();

  const name = document.getElementById("registerName").value.trim();
  const email = document.getElementById("registerEmail").value.trim().toLowerCase();
  const password = document.getElementById("registerPassword").value;
  const confirmPassword = document.getElementById("registerConfirmPassword").value;
  const authMessage = document.getElementById("authMessage");

  authMessage.style.color = "#dc2626";

  if (!name || !email || !password || !confirmPassword) {
    authMessage.textContent = "Please complete all fields.";
    return;
  }

  if (password.length < 6) {
    authMessage.textContent = "Password must be at least 6 characters.";
    return;
  }

  if (password !== confirmPassword) {
    authMessage.textContent = "Passwords do not match.";
    return;
  }

  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      data: { name }
    }
  });

  if (error) {
    authMessage.textContent = error.message;
    return;
  }

  authMessage.style.color = "#16a34a";
  authMessage.textContent = "Account created successfully. You can now sign in.";
  document.getElementById("registerForm").reset();
  switchAuthTab("login");
}

async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const password = document.getElementById("loginPassword").value;
  const authMessage = document.getElementById("authMessage");

  authMessage.style.color = "#dc2626";

  const { error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    authMessage.textContent = error.message;
  }
}

function setupLogout() {
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
  });
}

/* APP VISIBILITY */
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

/* DATABASE */
async function ensureProfileAndDefaults() {
  await supabaseClient.from("profiles").upsert({
    id: state.currentUser.id,
    name: state.currentUser.name,
    email: state.currentUser.email
  });

  const settingsRes = await supabaseClient
    .from("user_settings")
    .select("*")
    .eq("user_id", state.currentUser.id)
    .maybeSingle();

  if (!settingsRes.data) {
    await supabaseClient.from("user_settings").insert({
      user_id: state.currentUser.id,
      currency: "PHP",
      weekly_budget: 0,
      monthly_budget: 0,
      yearly_budget: 0
    });
  }

  const categoriesRes = await supabaseClient
    .from("categories")
    .select("id")
    .eq("user_id", state.currentUser.id)
    .limit(1);

  if (!categoriesRes.data || categoriesRes.data.length === 0) {
    const rows = DEFAULT_CATEGORIES.map((cat) => ({
      user_id: state.currentUser.id,
      name: cat.name,
      icon: cat.icon,
      color: cat.color,
      locked: cat.locked
    }));

    const { error } = await supabaseClient.from("categories").insert(rows);

    if (error && !isDuplicateCategoryError(error)) {
      console.error("Default category insert error:", error);
    }
  }
}

async function loadUserData() {
  const expensesResponse = await supabaseClient
    .from("expenses")
    .select("*")
    .eq("user_id", state.currentUser.id)
    .order("expense_date", { ascending: false });

  const categoriesResponse = await supabaseClient
    .from("categories")
    .select("*")
    .eq("user_id", state.currentUser.id)
    .order("created_at", { ascending: true });

  const settingsResponse = await supabaseClient
    .from("user_settings")
    .select("*")
    .eq("user_id", state.currentUser.id)
    .maybeSingle();

  if (expensesResponse.error) {
    console.error(expensesResponse.error);
    alert(expensesResponse.error.message);
  }

  if (categoriesResponse.error) {
    console.error(categoriesResponse.error);
    alert(categoriesResponse.error.message);
  }

  if (settingsResponse.error) {
    console.error(settingsResponse.error);
    alert(settingsResponse.error.message);
  }

  state.categories = categoriesResponse.data || [];

  state.expenses = (expensesResponse.data || []).map((expense) => {
    const category = state.categories.find((cat) => cat.id === expense.category_id);

    return {
      id: expense.id,
      amount: Number(expense.amount),
      description: expense.description,
      date: expense.expense_date,
      categoryId: expense.category_id,
      categoryName: category?.name || "Unknown",
      categoryIcon: category?.icon || "📦",
      categoryColor: category?.color || "gray"
    };
  });

  const settings = settingsResponse.data || null;
  state.settings = {
    currency: settings?.currency || "PHP",
    budgets: {
      weekly: Number(settings?.weekly_budget || 0),
      monthly: Number(settings?.monthly_budget || 0),
      yearly: Number(settings?.yearly_budget || 0)
    }
  };
}

/* NAVIGATION */
function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      showPage(item.dataset.page);
    });
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

/* EXPENSE FORM */
function setupExpenseForm() {
  document.getElementById("expenseForm").addEventListener("submit", handleAddExpense);

  document.getElementById("cancelExpenseBtn").addEventListener("click", () => {
    setTodayDate();
  });
}

async function handleAddExpense(event) {
  event.preventDefault();

  const amount = parseFloat(document.getElementById("amount").value);
  const categoryId = document.getElementById("categorySelect").value;
  const description = document.getElementById("description").value.trim();
  const expenseDate = document.getElementById("expenseDate").value;

  if (!amount || amount <= 0) {
    alert("Please enter a valid amount.");
    return;
  }

  if (!categoryId) {
    alert("Please select a category.");
    return;
  }

  if (!description) {
    alert("Please enter a description.");
    return;
  }

  const { error } = await supabaseClient.from("expenses").insert({
    user_id: state.currentUser.id,
    amount,
    description,
    expense_date: expenseDate,
    category_id: categoryId
  });

  if (error) {
    console.error("Add expense error:", error);
    alert(error.message);
    return;
  }

  event.target.reset();
  setTodayDate();
  await loadUserData();
  renderAll();
  showPage("all-expenses");
}

async function deleteExpense(id) {
  const confirmed = window.confirm("Delete this expense?");
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("user_id", state.currentUser.id);

  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  await loadUserData();
  renderAll();
}

/* SETTINGS */
function setupSettings() {
  document.getElementById("addCategoryForm").addEventListener("submit", handleAddCategory);

  const budgetForm = document.getElementById("budgetForm");
  if (budgetForm) {
    budgetForm.addEventListener("submit", handleSaveBudgetSettings);
  }
}

async function handleSaveBudgetSettings(event) {
  event.preventDefault();

  const currency = document.getElementById("currencyInput").value.trim().toUpperCase();
  const weekly = parseFloat(document.getElementById("weeklyBudgetInput").value || "0");
  const monthly = parseFloat(document.getElementById("monthlyBudgetInput").value || "0");
  const yearly = parseFloat(document.getElementById("yearlyBudgetInput").value || "0");

  if (!currency || currency.length !== 3) {
    alert("Currency must be 3 letters, like PHP.");
    return;
  }

  if (weekly < 0 || monthly < 0 || yearly < 0) {
    alert("Budgets cannot be negative.");
    return;
  }

  const { error } = await supabaseClient.from("user_settings").upsert({
    user_id: state.currentUser.id,
    currency,
    weekly_budget: weekly,
    monthly_budget: monthly,
    yearly_budget: yearly
  });

  if (error) {
    console.error("Save settings error:", error);
    alert(error.message);
    return;
  }

  await loadUserData();
  renderAll();
  alert("Budget settings saved successfully.");
}

async function handleAddCategory(event) {
  event.preventDefault();

  const name = document.getElementById("newCategoryName").value.trim();
  const icon = document.getElementById("newCategoryIcon").value.trim() || "🏷";

  if (!name) {
    alert("Please enter a category name.");
    return;
  }

  const { error } = await supabaseClient.from("categories").insert({
    user_id: state.currentUser.id,
    name,
    icon,
    color: "gray",
    locked: false
  });

  if (error) {
    console.error(error);

    if (isDuplicateCategoryError(error)) {
      alert("You already have a category with that name.");
    } else {
      alert(error.message);
    }
    return;
  }

  event.target.reset();
  await loadUserData();
  renderAll();
}

async function deleteCategory(id) {
  const used = state.expenses.some((expense) => expense.categoryId === id);

  if (used) {
    alert("This category is already used by an expense and cannot be deleted.");
    return;
  }

  const confirmed = window.confirm("Delete this category?");
  if (!confirmed) return;

  const { error } = await supabaseClient
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("user_id", state.currentUser.id);

  if (error) {
    console.error(error);
    alert(error.message);
    return;
  }

  await loadUserData();
  renderAll();
}

/* RENDER */
function renderAll() {
  renderCategorySelect();
  renderSettingsCategories();
  renderDashboard();
  renderExpensesList();
  fillSettingsForm();
  renderBudgetOverview();
}

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

function renderSettingsCategories() {
  const container = document.getElementById("settingsCategoryGrid");
  container.innerHTML = "";

  if (!state.categories.length) {
    container.innerHTML = `<div class="empty-state"><p>No categories yet</p></div>`;
    return;
  }

  state.categories.forEach((category) => {
    const item = document.createElement("div");
    item.className = "settings-category-item";
    item.innerHTML = `
      <div class="settings-left">
        <div class="icon-circle ${category.color || "gray"}">${category.icon}</div>
        <span>${escapeHtml(category.name)}</span>
      </div>
      <button class="delete-icon-btn" type="button">Delete</button>
    `;

    const btn = item.querySelector(".delete-icon-btn");

    if (category.locked) {
      btn.disabled = true;
      btn.style.opacity = "0.35";
      btn.style.cursor = "not-allowed";
    } else {
      btn.addEventListener("click", () => deleteCategory(category.id));
    }

    container.appendChild(item);
  });
}

function renderDashboard() {
  const total = sumExpenses(state.expenses);
  const monthExpenses = getCurrentMonthExpenses();
  const monthTotal = sumExpenses(monthExpenses);

  document.getElementById("dashboardTotal").textContent = formatCurrency(total);
  document.getElementById("dashboardMonthTotal").textContent = formatCurrency(monthTotal);
  document.getElementById("dashboardCount").textContent = state.expenses.length;

  const container = document.getElementById("recentExpensesContainer");
  container.innerHTML = "";

  if (!state.expenses.length) {
    container.innerHTML = `<div class="empty-state"><p>No expenses yet</p></div>`;
    return;
  }

  const recent = state.expenses.slice(0, 5);

  recent.forEach((expense) => {
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

function fillSettingsForm() {
  const currencyInput = document.getElementById("currencyInput");
  const weeklyBudgetInput = document.getElementById("weeklyBudgetInput");
  const monthlyBudgetInput = document.getElementById("monthlyBudgetInput");
  const yearlyBudgetInput = document.getElementById("yearlyBudgetInput");

  if (!currencyInput || !weeklyBudgetInput || !monthlyBudgetInput || !yearlyBudgetInput) return;

  currencyInput.value = state.settings.currency || "PHP";
  weeklyBudgetInput.value = Number(state.settings.budgets.weekly || 0);
  monthlyBudgetInput.value = Number(state.settings.budgets.monthly || 0);
  yearlyBudgetInput.value = Number(state.settings.budgets.yearly || 0);
}

function renderBudgetOverview() {
  const weekSpent = getCurrentWeekTotal();
  const monthSpent = sumExpenses(getCurrentMonthExpenses());
  const yearSpent = getCurrentYearTotal();

  const weeklyBudget = Number(state.settings.budgets.weekly || 0);
  const monthlyBudget = Number(state.settings.budgets.monthly || 0);
  const yearlyBudget = Number(state.settings.budgets.yearly || 0);

  const weeklyEl = document.getElementById("weeklyBudgetStatus");
  const monthlyEl = document.getElementById("monthlyBudgetStatus");
  const yearlyEl = document.getElementById("yearlyBudgetStatus");

  const weeklyHint = document.getElementById("weeklyBudgetHint");
  const monthlyHint = document.getElementById("monthlyBudgetHint");
  const yearlyHint = document.getElementById("yearlyBudgetHint");

  if (!weeklyEl || !monthlyEl || !yearlyEl || !weeklyHint || !monthlyHint || !yearlyHint) return;

  weeklyEl.textContent = `${formatCurrency(weekSpent)} / ${formatCurrency(weeklyBudget)}`;
  monthlyEl.textContent = `${formatCurrency(monthSpent)} / ${formatCurrency(monthlyBudget)}`;
  yearlyEl.textContent = `${formatCurrency(yearSpent)} / ${formatCurrency(yearlyBudget)}`;

  weeklyHint.textContent = buildBudgetHint(weekSpent, weeklyBudget);
  monthlyHint.textContent = buildBudgetHint(monthSpent, monthlyBudget);
  yearlyHint.textContent = buildBudgetHint(yearSpent, yearlyBudget);
}

/* HELPERS */
function setTodayDate() {
  document.getElementById("expenseDate").value = new Date().toISOString().split("T")[0];
}

function sumExpenses(expenses) {
  return expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
}

function getCurrentMonthExpenses() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();

  return state.expenses.filter((expense) => {
    const d = new Date(`${expense.date}T00:00:00`);
    return d.getMonth() === month && d.getFullYear() === year;
  });
}

function getCurrentWeekTotal() {
  const now = new Date();
  const currentDay = now.getDay();
  const diffToMonday = currentDay === 0 ? 6 : currentDay - 1;

  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(now.getDate() - diffToMonday);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);

  return state.expenses.reduce((sum, expense) => {
    const expenseDate = new Date(`${expense.date}T00:00:00`);
    if (expenseDate >= startOfWeek && expenseDate < endOfWeek) {
      return sum + Number(expense.amount || 0);
    }
    return sum;
  }, 0);
}

function getCurrentYearTotal() {
  const now = new Date();
  const year = now.getFullYear();

  return state.expenses.reduce((sum, expense) => {
    const expenseDate = new Date(`${expense.date}T00:00:00`);
    if (expenseDate.getFullYear() === year) {
      return sum + Number(expense.amount || 0);
    }
    return sum;
  }, 0);
}

function buildBudgetHint(spent, budget) {
  if (!budget || budget <= 0) {
    return "No budget set";
  }

  const remaining = budget - spent;

  if (remaining >= 0) {
    return `Remaining: ${formatCurrency(remaining)}`;
  }

  return `Over budget by ${formatCurrency(Math.abs(remaining))}`;
}

function formatCurrency(amount) {
  const currency = state.settings?.currency || "PHP";

  try {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency
    }).format(amount || 0);
  } catch (_error) {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
}

function formatDisplayDate(dateString) {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function isDuplicateCategoryError(error) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return message.includes("duplicate") || message.includes("unique");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}