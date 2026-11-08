
"use strict";

// =====================================
// FIREBASE INITIALIZATION
// =====================================

if (!window.firebaseConfig || !window.firebaseConfig.apiKey ||
    window.firebaseConfig.apiKey === "YOUR_FIREBASE_API_KEY") {
  alert("Firebase API Key firebase-config.js ফাইলে সেট করুন!");
  throw new Error("Firebase configuration missing");
}

if (!firebase.apps.length) {
  firebase.initializeApp(window.firebaseConfig);
}

const auth = firebase.auth();

// =====================================
// DOM HELPERS
// =====================================

const $ = id => document.getElementById(id);

let selectedUserId = null;
let selectedUserData = null;
let currentUsers = [];

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function money(value) {
  return "৳" + Number(value || 0).toLocaleString("en-BD");
}

function dateTime(value) {
  if (!value) return "Unknown";

  return new Date(Number(value)).toLocaleString("en-BD", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function message(id, text, success = false) {
  const el = $(id);
  if (!el) return;

  el.textContent = text;
  el.style.color = success ? "#15803d" : "#dc2626";
}

function loadingButton(button, loading, originalText) {
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading ? "Please wait..." : originalText;
}

// =====================================
// API REQUEST
// =====================================

async function adminApi(url, method = "GET", body = null) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please login again");
  }

  const token = await user.getIdToken();

  const options = {
    method,
    headers: {
      Authorization: "Bearer " + token
    }
  };

  if (body !== null) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error("Invalid server response");
  }

  if (!response.ok || data.success === false) {
    throw new Error(data.message || "Request failed");
  }

  return data;
}

// =====================================
// PAGE NAVIGATION
// =====================================

document.querySelectorAll(".sidebar button[data-page]").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;

    document.querySelectorAll(".sidebar button").forEach(item => {
      item.classList.remove("active");
    });

    button.classList.add("active");

    document.querySelectorAll(".section").forEach(section => {
      section.classList.remove("active");
    });

    const target = $(page);

    if (target) {
      target.classList.add("active");
    }

    if (page === "dashboard") {
      loadStats();
      loadRecentLogs();
    }

    if (page === "users") {
      loadUsers();
    }

    if (page === "logs") {
      loadLogs();
    }

    if (page === "transactions" && selectedUserData) {
      showSelectedUser(selectedUserData);
    }
  });
});

// =====================================
// ADMIN CHECK
// =====================================

async function checkAdmin() {
  try {
    const result = await adminApi("/api/admin/check");

    if (!result.admin) {
      throw new Error("Admin permission required");
    }

    $("adminLoading").classList.add("hidden");
    $("adminDashboard").classList.remove("hidden");

    await loadStats();
    await loadUsers();
    await loadRecentLogs();

  } catch (error) {
    console.error(error);

    $("adminLoading").textContent =
      error.message || "Admin access denied";
  }
}

// =====================================
// DASHBOARD STATISTICS
// =====================================

async function loadStats() {
  try {
    const data = await adminApi("/api/admin/stats");

    $("totalUsers").textContent =
      Number(data.totalUsers || 0).toLocaleString("en-BD");

    $("activeUsers").textContent =
      Number(data.activeUsers || 0).toLocaleString("en-BD");

    $("bannedUsers").textContent =
      Number(data.bannedUsers || 0).toLocaleString("en-BD");

    $("totalBalance").textContent = money(data.totalBalance);

  } catch (error) {
    console.error("Stats:", error);
  }
}

// =====================================
// SEARCH USER
// =====================================

async function searchUser(userId, outputId) {
  const id = String(userId || "").trim();

  if (!/^\d{7}$/.test(id)) {
    message(outputId, "সঠিক ৭ ডিজিটের User ID লিখুন");
    return;
  }

  try {
    const data = await adminApi(
      "/api/admin/user/" + encodeURIComponent(id)
    );

    selectedUserId = id;
    selectedUserData = data;

    showSelectedUser(data);
    showTransactions(data.transactions || []);

    const result = `
      <div class="user-card">
        <strong>${escapeHTML(data.user.name)}</strong>
        <p>User ID: ${escapeHTML(data.user.userId)}</p>
        <p>Email: ${escapeHTML(data.user.email)}</p>
        <p>Balance: ${money(data.wallet.balance)}</p>
        <p>Status:
          <span class="badge ${
            data.user.status === "banned"
              ? "banned-badge"
              : "active-badge"
          }">
            ${escapeHTML(data.user.status || "active")}
          </span>
        </p>
        <button class="btn-dark" id="openUserTransactions">
          Manage User
        </button>
      </div>
    `;

    $(outputId).innerHTML = result;

    const openButton = $("openUserTransactions");

    if (openButton) {
      openButton.addEventListener("click", () => {
        openPage("transactions");
      });
    }

  } catch (error) {
    $(outputId).textContent = error.message;
    $(outputId).style.color = "#dc2626";
  }
}

function openPage(page) {
  const button = document.querySelector(
    `.sidebar button[data-page="${page}"]`
  );

  if (button) button.click();
}

// =====================================
// SELECTED USER
// =====================================

function showSelectedUser(data) {
  if (!data || !data.user) return;

  const user = data.user;
  const wallet = data.wallet || {};

  $("selectedUser").innerHTML = `
    <div class="user-card">
      <strong>${escapeHTML(user.name)}</strong>
      <p>User ID: ${escapeHTML(user.userId)}</p>
      <p>Email: ${escapeHTML(user.email)}</p>
      <p>UID: ${escapeHTML(user.uid)}</p>
      <p>Balance: <strong>${money(wallet.balance)}</strong></p>
      <p>Status:
        <span class="badge ${
          user.status === "banned"
            ? "banned-badge"
            : "active-badge"
        }">
          ${escapeHTML(user.status || "active")}
        </span>
      </p>
      <p>Created: ${dateTime(user.createdAt)}</p>
      ${
        user.banReason
          ? `<p>Ban reason: ${escapeHTML(user.banReason)}</p>`
          : ""
      }
    </div>
  `;
}

// =====================================
// TRANSACTION HISTORY
// =====================================

function showTransactions(transactions) {
  const container = $("transactionList");

  if (!container) return;

  if (!transactions || transactions.length === 0) {
    container.innerHTML =
      '<div class="empty">No transactions found</div>';
    return;
  }

  container.innerHTML = transactions.map(item => {
    const isCredit = item.type === "credit";

    return `
      <div class="transaction">
        <div>
          <strong>${escapeHTML(item.reason || item.type)}</strong>
          <small>${dateTime(item.createdAt)}</small>
          <small>Balance after: ${money(item.balanceAfter)}</small>
        </div>

        <div class="${isCredit ? "credit" : "debit"}">
          ${isCredit ? "+" : "-"}${money(item.amount)}
        </div>
      </div>
    `;
  }).join("");
}

// =====================================
// LOAD ALL USERS
// =====================================

async function loadUsers() {
  try {
    const data = await adminApi("/api/admin/users");

    currentUsers = data.users || [];

    const container = $("userList");

    if (!currentUsers.length) {
      container.innerHTML =
        '<div class="empty">No users found</div>';
      return;
    }

    container.innerHTML = currentUsers.map(user => `
      <div class="user-card">
        <strong>${escapeHTML(user.name)}</strong>

        <p>User ID: ${escapeHTML(user.userId)}</p>
        <p>Email: ${escapeHTML(user.email)}</p>

        <p>Status:
          <span class="badge ${
            user.status === "banned"
              ? "banned-badge"
              : "active-badge"
          }">
            ${escapeHTML(user.status)}
          </span>
        </p>

        <p>Created: ${dateTime(user.createdAt)}</p>

        <button
          class="manage-user-btn"
          data-user-id="${escapeHTML(user.userId)}">
          Manage
        </button>
      </div>
    `).join("");

    container.querySelectorAll(".manage-user-btn").forEach(button => {
      button.addEventListener("click", () => {
        searchUser(button.dataset.userId, "userResult2");
        openPage("transactions");
      });
    });

  } catch (error) {
    $("userList").textContent = error.message;
  }
}

// =====================================
// ADD / DEDUCT BALANCE
// =====================================

async function balanceAction(type) {
  if (!selectedUserId) {
    return message("actionMessage", "আগে একজন User Search করুন");
  }

  const amount = Number($("actionAmount").value);
  const reason = $("actionReason").value.trim();

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return message("actionMessage", "সঠিক পূর্ণ টাকার Amount দিন");
  }

  if (!confirm(
    `${type === "credit" ? "Add" : "Deduct"} ৳${amount} করতে চান?`
  )) {
    return;
  }

  const buttonId = type === "credit" ? "addBalance" : "deductBalance";
  const button = $(buttonId);

  loadingButton(
    button,
    true,
    type === "credit" ? "Add Balance" : "Deduct Balance"
  );

  try {
    const data = await adminApi(
      type === "credit"
        ? "/api/admin/credit"
        : "/api/admin/debit",
      "POST",
      {
        userId: selectedUserId,
        amount,
        reason
      }
    );

    message("actionMessage", data.message, true);

    $("actionAmount").value = "";
    $("actionReason").value = "";

    await refreshSelectedUser();
    await loadStats();
    await loadRecentLogs();

  } catch (error) {
    message("actionMessage", error.message);
  } finally {
    loadingButton(
      button,
      false,
      type === "credit" ? "Add Balance" : "Deduct Balance"
    );
  }
}

// =====================================
// REFRESH SELECTED USER
// =====================================

async function refreshSelectedUser() {
  if (!selectedUserId) return;

  const data = await adminApi(
    "/api/admin/user/" + encodeURIComponent(selectedUserId)
  );

  selectedUserData = data;

  showSelectedUser(data);
  showTransactions(data.transactions || []);

  const searchResult = $("userResult");
  const searchResult2 = $("userResult2");

  if (searchResult && searchResult.innerHTML) {
    searchUser(selectedUserId, "userResult");
  }

  if (searchResult2 && searchResult2.innerHTML) {
    searchUser(selectedUserId, "userResult2");
  }

  await loadUsers();
}

// =====================================
// BAN USER
// =====================================

async function banUser() {
  if (!selectedUserId) {
    return message("actionMessage", "আগে একজন User Search করুন");
  }

  if (selectedUserData?.user?.status === "banned") {
    return message("actionMessage", "User already banned");
  }

  const reason = prompt("Ban করার কারণ লিখুন:");

  if (reason === null) return;

  if (!confirm("এই User-কে Ban করতে চান?")) return;

  try {
    const data = await adminApi(
      "/api/admin/user/ban",
      "POST",
      {
        userId: selectedUserId,
        reason
      }
    );

    message("actionMessage", data.message, true);

    await refreshSelectedUser();
    await loadStats();
    await loadRecentLogs();

  } catch (error) {
    message("actionMessage", error.message);
  }
}

// =====================================
// UNBAN USER
// =====================================

async function unbanUser() {
  if (!selectedUserId) {
    return message("actionMessage", "আগে একজন User Search করুন");
  }

  if (!confirm("এই User-কে Unban করতে চান?")) return;

  try {
    const data = await adminApi(
      "/api/admin/user/unban",
      "POST",
      {
        userId: selectedUserId
      }
    );

    message("actionMessage", data.message, true);

    await refreshSelectedUser();
    await loadStats();
    await loadRecentLogs();

  } catch (error) {
    message("actionMessage", error.message);
  }
}

// =====================================
// DELETE USER
// =====================================

async function deleteUser() {
  if (!selectedUserId) {
    return message("actionMessage", "আগে একজন User Search করুন");
  }

  const confirmation = prompt(
    `User ID ${selectedUserId} স্থায়ীভাবে Delete করতে লিখুন DELETE`
  );

  if (confirmation !== "DELETE") {
    return;
  }

  try {
    const data = await adminApi(
      "/api/admin/user/delete",
      "POST",
      {
        userId: selectedUserId
      }
    );

    message("actionMessage", data.message, true);

    selectedUserId = null;
    selectedUserData = null;

    $("selectedUser").innerHTML =
      '<div class="empty">No user selected</div>';

    $("transactionList").innerHTML =
      '<div class="empty">No transactions</div>';

    $("userResult").innerHTML = "";
    $("userResult2").innerHTML = "";

    await loadStats();
    await loadUsers();
    await loadRecentLogs();

  } catch (error) {
    message("actionMessage", error.message);
  }
}

// =====================================
// ADMIN ACTIVITY LOGS
// =====================================

function renderLogs(logs, containerId) {
  const container = $(containerId);

  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML =
      '<div class="empty">No activity logs found</div>';
    return;
  }

  container.innerHTML = logs.map(log => `
    <div class="log-item">
      <strong>${escapeHTML(log.action || "ACTION")}</strong>
      <p>User ID: ${escapeHTML(log.userId || "-")}</p>
      <p>Admin UID: ${escapeHTML(log.adminUid || "-")}</p>
      <p>Details: ${escapeHTML(
        JSON.stringify(log.details || {})
      )}</p>
      <small>${dateTime(log.createdAt)}</small>
    </div>
  `).join("");
}

async function loadLogs() {
  try {
    const data = await adminApi("/api/admin/logs");
    renderLogs(data.logs || [], "activityLogs");
  } catch (error) {
    $("activityLogs").textContent = error.message;
  }
}

async function loadRecentLogs() {
  try {
    const data = await adminApi("/api/admin/logs");

    const recent = (data.logs || []).slice(0, 5);

    renderLogs(recent, "adminTransactions");

  } catch (error) {
    $("adminTransactions").textContent = error.message;
  }
}

// =====================================
// BUTTON EVENTS
// =====================================

$("searchBtn").addEventListener("click", () => {
  searchUser($("searchUserId").value, "userResult");
});

$("searchBtn2").addEventListener("click", () => {
  searchUser($("searchUserId2").value, "userResult2");
});

$("searchUserId").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    searchUser($("searchUserId").value, "userResult");
  }
});

$("searchUserId2").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    searchUser($("searchUserId2").value, "userResult2");
  }
});

$("refreshUsers").addEventListener("click", loadUsers);
$("refreshLogs").addEventListener("click", loadLogs);

$("addBalance").addEventListener("click", () => {
  balanceAction("credit");
});

$("deductBalance").addEventListener("click", () => {
  balanceAction("debit");
});

$("banUser").addEventListener("click", banUser);
$("unbanUser").addEventListener("click", unbanUser);
$("deleteUser").addEventListener("click", deleteUser);

// =====================================
// LOGOUT
// =====================================

$("adminLogout").addEventListener("click", async () => {
  if (!confirm("Logout করতে চান?")) return;

  try {
    await auth.signOut();
    window.location.href = "/";
  } catch (error) {
    alert(error.message);
  }
});

// =====================================
// AUTH STATE
// =====================================

auth.onAuthStateChanged(user => {
  if (!user) {
    window.location.href = "/";
    return;
  }

  checkAdmin();
});
