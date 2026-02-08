(function () {
  const memberStatus = document.getElementById("memberStatus");
  const loginForm = document.getElementById("memberLoginForm");
  const registerForm = document.getElementById("memberRegisterForm");
  const loginFormMessage = document.getElementById("loginFormMessage");
  const registerFormMessage = document.getElementById("registerFormMessage");
  const loginAccount = document.getElementById("loginAccount");
  const loginPassword = document.getElementById("loginPassword");
  const registerFullName = document.getElementById("registerFullName");
  const registerAccount = document.getElementById("registerAccount");
  const registerPhone = document.getElementById("registerPhone");
  const registerEmail = document.getElementById("registerEmail");
  const registerPassword = document.getElementById("registerPassword");
  const registerPasswordConfirm = document.getElementById("registerPasswordConfirm");
  const authTabs = document.querySelectorAll(".tab[data-tab]");

  const supabase = window.App.getSupabaseClient();
  const orderPagePath = "order.html";
  const accountEmailMapKey = "member_account_email_map_v1";
  let suppressAutoRedirect = false;

  function setMemberStatus(isLoggedIn) {
    if (!memberStatus) {
      return;
    }
    memberStatus.textContent = isLoggedIn ? "已登入" : "尚未登入";
    memberStatus.classList.toggle("open", isLoggedIn);
    memberStatus.classList.toggle("closed", !isLoggedIn);
  }

  function setActiveAuthTab(tab) {
    authTabs.forEach((button) => {
      const isActive = button.dataset.tab === tab;
      button.classList.toggle("active", isActive);
    });
    if (loginForm) {
      loginForm.classList.toggle("hidden", tab !== "login");
    }
    if (registerForm) {
      registerForm.classList.toggle("hidden", tab !== "register");
    }
  }

  function setAuthMessage(element, text, type) {
    if (!element) {
      return;
    }
    element.textContent = text;
    element.className = `form-message ${type || ""}`.trim();
  }

  function normalizePhone(value) {
    return String(value || "").trim().replace(/[^\d+]/g, "");
  }

  function normalizeAccount(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function normalizeEmail(value) {
    return String(value || "")
      .trim()
      .toLowerCase();
  }

  function looksLikeEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
  }

  function buildAuthEmailFromAccount(account) {
    return `${normalizeAccount(account)}@member.local`;
  }

  function loadAccountEmailMap() {
    const raw = localStorage.getItem(accountEmailMapKey);
    if (!raw) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        return {};
      }
      return parsed;
    } catch (_error) {
      return {};
    }
  }

  function saveAccountEmailMap(map) {
    localStorage.setItem(accountEmailMapKey, JSON.stringify(map || {}));
  }

  function rememberAccountEmail(account, email) {
    const normalizedAccount = normalizeAccount(account);
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedAccount || !normalizedEmail) {
      return;
    }
    const map = loadAccountEmailMap();
    map[normalizedAccount] = normalizedEmail;
    saveAccountEmailMap(map);
  }

  function getRememberedEmail(account) {
    const normalizedAccount = normalizeAccount(account);
    if (!normalizedAccount) {
      return "";
    }
    const map = loadAccountEmailMap();
    return String(map[normalizedAccount] || "");
  }

  function buildLoginCandidates(input) {
    const raw = String(input || "").trim();
    if (!raw) {
      return [];
    }

    if (looksLikeEmail(raw)) {
      return [normalizeEmail(raw)];
    }

    const account = normalizeAccount(raw);
    const remembered = getRememberedEmail(account);
    const candidates = [];

    if (remembered) {
      candidates.push(remembered);
    }

    candidates.push(buildAuthEmailFromAccount(account));
    return Array.from(new Set(candidates));
  }

  function redirectToOrder() {
    window.location.href = orderPagePath;
  }

  async function upsertMemberProfile(userId, profile) {
    if (!supabase || !userId || !profile) {
      return { error: null };
    }

    const payload = {
      user_id: userId,
      full_name: profile.full_name,
      account: profile.account,
      email: profile.email,
      real_phone: profile.real_phone,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("member_profiles")
      .upsert(payload, { onConflict: "user_id" });

    return { error };
  }

  if (!window.App.configOk) {
    setAuthMessage(loginFormMessage, "請先設定 assets/config.js", "error");
    setAuthMessage(registerFormMessage, "請先設定 assets/config.js", "error");
  }

  setActiveAuthTab("login");
  setMemberStatus(false);

  authTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveAuthTab(button.dataset.tab);
    });
  });

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!supabase) {
        setAuthMessage(loginFormMessage, "請先設定 assets/config.js", "error");
        return;
      }

      const loginId = String(loginAccount?.value || "").trim();
      if (!loginId) {
        setAuthMessage(loginFormMessage, "請輸入帳號或 Email。", "error");
        return;
      }
      if (!loginPassword.value) {
        setAuthMessage(loginFormMessage, "請輸入密碼。", "error");
        return;
      }

      setAuthMessage(loginFormMessage, "登入中...", "");

      const candidates = buildLoginCandidates(loginId);
      let success = false;
      let lastError = null;
      for (const email of candidates) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password: loginPassword.value,
        });

        if (!error && data?.session?.user) {
          const accountFromMeta = normalizeAccount(
            data.session.user.user_metadata?.account || (!looksLikeEmail(loginId) ? loginId : "")
          );
          if (accountFromMeta) {
            rememberAccountEmail(accountFromMeta, data.session.user.email || email);
          }
          success = true;
          break;
        }

        lastError = error;
      }

      if (!success) {
        const hint = looksLikeEmail(loginId)
          ? "登入失敗，請確認 Email 與密碼。"
          : "登入失敗，請確認帳號與密碼；若是舊帳號可改用 Email 登入一次。";
        setAuthMessage(loginFormMessage, hint, "error");
        if (lastError?.message) {
          console.warn("login failed", lastError.message);
        }
        return;
      }

      setAuthMessage(loginFormMessage, "登入成功，跳轉中...", "success");
      redirectToOrder();
    });
  }

  if (registerForm) {
    registerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!supabase) {
        setAuthMessage(registerFormMessage, "請先設定 assets/config.js", "error");
        return;
      }

      const fullName = registerFullName.value.trim();
      const account = normalizeAccount(registerAccount.value);
      const phone = normalizePhone(registerPhone.value);
      const email = normalizeEmail(registerEmail.value);
      const password = registerPassword.value;
      const passwordConfirm = registerPasswordConfirm.value;

      if (!fullName || !account || !phone || !email || !password || !passwordConfirm) {
        setAuthMessage(registerFormMessage, "請完整填寫所有欄位。", "error");
        return;
      }
      if (!/^[a-z0-9]{6,30}$/.test(account)) {
        setAuthMessage(registerFormMessage, "帳號需為 6-30 位英文小寫或數字。", "error");
        return;
      }
      if (phone.length < 8 || phone.length > 20) {
        setAuthMessage(registerFormMessage, "請輸入有效電話。", "error");
        return;
      }
      if (!looksLikeEmail(email)) {
        setAuthMessage(registerFormMessage, "請輸入有效 Email。", "error");
        return;
      }
      if (password.length < 6) {
        setAuthMessage(registerFormMessage, "密碼至少 6 碼。", "error");
        return;
      }
      if (password !== passwordConfirm) {
        setAuthMessage(registerFormMessage, "兩次密碼不一致。", "error");
        return;
      }

      setAuthMessage(registerFormMessage, "註冊中...", "");
      suppressAutoRedirect = true;

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            account,
            real_phone: phone,
            contact_email: email,
          },
        },
      });

      if (error) {
        suppressAutoRedirect = false;
        setAuthMessage(
          registerFormMessage,
          "註冊失敗，帳號/Email/電話可能已存在。",
          "error"
        );
        return;
      }

      if (data?.user) {
        const { error: profileError } = await upsertMemberProfile(data.user.id, {
          full_name: fullName,
          account,
          email,
          real_phone: phone,
        });
        if (profileError) {
          suppressAutoRedirect = false;
          setAuthMessage(
            registerFormMessage,
            "註冊完成但會員資料建立失敗，請重新登入。",
            "error"
          );
          return;
        }
      }

      rememberAccountEmail(account, email);

      if (data?.session) {
        await supabase.auth.signOut();
      }
      suppressAutoRedirect = false;

      setAuthMessage(registerFormMessage, "註冊成功，請使用帳號與密碼登入。", "success");
      setActiveAuthTab("login");
      if (loginAccount) {
        loginAccount.value = account;
      }
      if (loginPassword) {
        loginPassword.value = "";
      }
    });
  }

  if (supabase) {
    supabase.auth.onAuthStateChange((_event, session) => {
      const isLoggedIn = Boolean(session?.user);
      setMemberStatus(isLoggedIn);
      if (suppressAutoRedirect) {
        return;
      }
      if (isLoggedIn) {
        const accountFromMeta = normalizeAccount(session.user.user_metadata?.account || "");
        if (accountFromMeta && session.user.email) {
          rememberAccountEmail(accountFromMeta, session.user.email);
        }
        redirectToOrder();
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      const isLoggedIn = Boolean(data?.session?.user);
      setMemberStatus(isLoggedIn);
      if (isLoggedIn) {
        const accountFromMeta = normalizeAccount(data.session.user.user_metadata?.account || "");
        if (accountFromMeta && data.session.user.email) {
          rememberAccountEmail(accountFromMeta, data.session.user.email);
        }
        redirectToOrder();
      }
    });
  }
})();
