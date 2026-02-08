(function () {
  const form = document.getElementById("changePasswordForm");
  const currentPassword = document.getElementById("currentPassword");
  const newPassword = document.getElementById("newPassword");
  const confirmNewPassword = document.getElementById("confirmNewPassword");
  const messageEl = document.getElementById("changePasswordMessage");
  const saveBtn = document.getElementById("savePasswordBtn");
  const globalLogoutBtn = document.getElementById("globalLogoutBtn");

  if (!form || !currentPassword || !newPassword || !confirmNewPassword) {
    return;
  }

  const supabase = window.App.getSupabaseClient();
  const loginPagePath = "index.html";

  let currentSession = null;

  function redirectToLogin() {
    window.location.href = loginPagePath;
  }

  function setMessage(text, type) {
    if (!messageEl) {
      return;
    }
    messageEl.textContent = text;
    messageEl.className = `form-message ${type || ""}`.trim();
  }

  async function handleSessionChange(session, options) {
    currentSession = session || null;
    const allowRedirect = Boolean(options?.allowRedirect);

    if (!currentSession?.user && allowRedirect) {
      redirectToLogin();
    }
  }

  async function submitChangePassword(event) {
    event.preventDefault();

    if (!supabase || !currentSession?.user) {
      setMessage("登入狀態失效，請重新登入。", "error");
      return;
    }

    const oldPassword = currentPassword.value;
    const nextPassword = newPassword.value;
    const nextConfirm = confirmNewPassword.value;

    if (!oldPassword || !nextPassword || !nextConfirm) {
      setMessage("請完整填寫所有欄位。", "error");
      return;
    }
    if (nextPassword.length < 6) {
      setMessage("新密碼至少 6 碼。", "error");
      return;
    }
    if (nextPassword !== nextConfirm) {
      setMessage("兩次新密碼不一致。", "error");
      return;
    }
    if (oldPassword === nextPassword) {
      setMessage("新密碼不可與原密碼相同。", "error");
      return;
    }

    saveBtn.disabled = true;
    setMessage("驗證原密碼中...", "");

    const userEmail = String(currentSession.user.email || "").trim();
    if (!userEmail) {
      setMessage("找不到登入帳號，請重新登入後再試。", "error");
      saveBtn.disabled = false;
      return;
    }

    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: userEmail,
      password: oldPassword,
    });

    if (verifyError) {
      setMessage("原密碼不正確。", "error");
      saveBtn.disabled = false;
      return;
    }

    setMessage("更新密碼中...", "");

    const { error: updateError } = await supabase.auth.updateUser({
      password: nextPassword,
    });

    if (updateError) {
      setMessage(`修改失敗：${updateError.message}`, "error");
      saveBtn.disabled = false;
      return;
    }

    currentPassword.value = "";
    newPassword.value = "";
    confirmNewPassword.value = "";
    setMessage("密碼已成功更新。", "success");
    saveBtn.disabled = false;
  }

  if (!window.App.configOk) {
    setMessage("Please configure assets/config.js", "error");
  }

  form.addEventListener("submit", submitChangePassword);

  if (globalLogoutBtn) {
    globalLogoutBtn.addEventListener("click", async () => {
      if (supabase) {
        await supabase.auth.signOut();
      }
      redirectToLogin();
    });
  }

  if (supabase) {
    supabase.auth.onAuthStateChange((_event, session) => {
      handleSessionChange(session, { allowRedirect: true });
    });

    supabase.auth.getSession().then(({ data }) => {
      handleSessionChange(data.session, { allowRedirect: true });
    });
  }
})();
