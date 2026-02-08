(function () {
  const profileForm = document.getElementById("profileForm");
  const profileMessage = document.getElementById("profileMessage");
  const profileFullName = document.getElementById("profileFullName");
  const profileAccount = document.getElementById("profileAccount");
  const profileMobile = document.getElementById("profileMobile");
  const profileEmail = document.getElementById("profileEmail");
  const editProfileBtn = document.getElementById("editProfileBtn");
  const cancelEditProfileBtn = document.getElementById("cancelEditProfileBtn");
  const saveProfileBtn = document.getElementById("saveProfileBtn");
  const globalLogoutBtn = document.getElementById("globalLogoutBtn");

  if (!profileForm || !profileFullName || !profileAccount || !profileMobile || !profileEmail) {
    return;
  }

  const supabase = window.App.getSupabaseClient();
  const loginPagePath = "index.html";

  let currentSession = null;
  let isEditing = false;
  let profileSnapshot = null;

  function redirectToLogin() {
    window.location.href = loginPagePath;
  }

  function setMessage(text, type) {
    if (!profileMessage) {
      return;
    }
    profileMessage.textContent = text;
    profileMessage.className = `form-message ${type || ""}`.trim();
  }

  function normalizePhone(value) {
    return String(value || "").trim().replace(/[^\d+]/g, "");
  }

  function normalizeAccount(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function setEditMode(editing) {
    isEditing = Boolean(editing);

    [profileFullName, profileAccount, profileMobile, profileEmail].forEach((input) => {
      input.readOnly = !isEditing;
    });

    if (editProfileBtn) {
      editProfileBtn.classList.toggle("hidden", isEditing);
    }
    if (cancelEditProfileBtn) {
      cancelEditProfileBtn.classList.toggle("hidden", !isEditing);
    }
    if (saveProfileBtn) {
      saveProfileBtn.classList.toggle("hidden", !isEditing);
    }
  }

  function fillForm(profile) {
    profileFullName.value = profile?.full_name || "";
    profileAccount.value = profile?.account || "";
    profileMobile.value = profile?.real_phone || "";
    profileEmail.value = profile?.email || currentSession?.user?.email || "";
  }

  function snapshotFromForm() {
    return {
      full_name: profileFullName.value.trim(),
      account: normalizeAccount(profileAccount.value),
      real_phone: normalizePhone(profileMobile.value),
      email: profileEmail.value.trim().toLowerCase(),
    };
  }

  function validateProfile(profile) {
    if (!profile.full_name || !profile.account || !profile.real_phone || !profile.email) {
      return "請完整填寫所有欄位。";
    }
    if (!/^[a-z0-9]{6,30}$/.test(profile.account)) {
      return "會員帳號需為 6-30 位英文小寫或數字。";
    }
    if (profile.real_phone.length < 8 || profile.real_phone.length > 20) {
      return "請輸入有效手機號碼。";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
      return "請輸入有效郵箱。";
    }
    return "";
  }

  async function loadProfile() {
    if (!supabase || !currentSession?.user) {
      return null;
    }

    const user = currentSession.user;
    const { data, error } = await supabase
      .from("member_profiles")
      .select("user_id, full_name, account, email, real_phone")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error && data) {
      return data;
    }

    return {
      user_id: user.id,
      full_name: String(user.user_metadata?.full_name || ""),
      account: String(user.user_metadata?.account || ""),
      email: String(user.user_metadata?.contact_email || user.email || ""),
      real_phone: String(user.user_metadata?.real_phone || ""),
    };
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!isEditing) {
      return;
    }

    if (!supabase || !currentSession?.user) {
      setMessage("登入狀態失效，請重新登入。", "error");
      return;
    }

    const nextProfile = snapshotFromForm();
    const invalidReason = validateProfile(nextProfile);
    if (invalidReason) {
      setMessage(invalidReason, "error");
      return;
    }

    setMessage("儲存中...", "");

    const currentAuthEmail = String(currentSession.user.email || "").toLowerCase();
    const emailChanged = nextProfile.email !== currentAuthEmail;

    const authPayload = {
      data: {
        full_name: nextProfile.full_name,
        account: nextProfile.account,
        real_phone: nextProfile.real_phone,
        contact_email: nextProfile.email,
      },
    };

    if (emailChanged) {
      authPayload.email = nextProfile.email;
    }

    const { error: authError } = await supabase.auth.updateUser(authPayload);
    if (authError) {
      setMessage(`更新會員帳號失敗：${authError.message}`, "error");
      return;
    }

    const { error: profileError } = await supabase.from("member_profiles").upsert(
      {
        user_id: currentSession.user.id,
        full_name: nextProfile.full_name,
        account: nextProfile.account,
        email: nextProfile.email,
        real_phone: nextProfile.real_phone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (profileError) {
      setMessage(`儲存資料失敗：${profileError.message}`, "error");
      return;
    }

    profileSnapshot = { ...nextProfile };
    fillForm(profileSnapshot);
    setEditMode(false);
    if (emailChanged) {
      setMessage("資料已更新，請到新郵箱收驗證信完成變更。", "success");
    } else {
      setMessage("會員資料已更新。", "success");
    }
  }

  function cancelEdit() {
    if (profileSnapshot) {
      fillForm(profileSnapshot);
    }
    setEditMode(false);
    setMessage("", "");
  }

  async function handleSessionChange(session, options) {
    currentSession = session || null;
    const allowRedirect = Boolean(options?.allowRedirect);
    const isLoggedIn = Boolean(currentSession?.user);

    if (!isLoggedIn) {
      if (allowRedirect) {
        redirectToLogin();
      }
      return;
    }

    const profile = await loadProfile();
    if (!profile) {
      setMessage("讀取會員資料失敗，請稍後再試。", "error");
      return;
    }

    profileSnapshot = {
      full_name: profile.full_name || "",
      account: profile.account || "",
      real_phone: profile.real_phone || "",
      email: profile.email || currentSession.user.email || "",
    };
    fillForm(profileSnapshot);
    setEditMode(false);
    setMessage("", "");
  }

  if (!window.App.configOk) {
    setMessage("Please configure assets/config.js", "error");
  }

  profileForm.addEventListener("submit", saveProfile);

  if (editProfileBtn) {
    editProfileBtn.addEventListener("click", () => {
      setEditMode(true);
      setMessage("", "");
    });
  }

  if (cancelEditProfileBtn) {
    cancelEditProfileBtn.addEventListener("click", cancelEdit);
  }

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
