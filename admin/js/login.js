(function () {
  'use strict';

  const form = document.getElementById('adminLoginForm');
  const errBox = document.getElementById('loginErrorBox');
  const submitBtn = document.getElementById('loginSubmitBtn');
  const toggleBtn = document.getElementById('togglePassBtn');
  const passInput = document.getElementById('adminPassword');

  if (toggleBtn && passInput) {
    toggleBtn.addEventListener('click', () => {
      const isPass = passInput.type === 'password';
      passInput.type = isPass ? 'text' : 'password';
      toggleBtn.textContent = isPass ? 'Hide' : 'Show';
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errBox.classList.add('hidden');
      const username = document.getElementById('adminUsername').value.trim();
      const password = passInput.value;

      if (!username || !password) {
        errBox.textContent = 'Please enter both username and password.';
        errBox.classList.remove('hidden');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Authenticating...';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
        if (res.status === 404 || res.status === 405) {
          const localRaw = localStorage.getItem('gasg_master_db_v1');
          const dbObj = localRaw ? JSON.parse(localRaw) : {};
          const admins = dbObj.admins || [
            { id: 1, username: 'admin', password: 'GasgAdmin@114272', full_name: 'GASG Chief Administrator', role: 'Super Administrator' }
          ];
          const matched = admins.find(
            (u) => u.username.toLowerCase() === username.toLowerCase() && (u.password || 'GasgAdmin@114272') === password
          );
          if (!matched) {
            throw new Error('Invalid administrator username or password.');
          }
          sessionStorage.setItem(
            'gasg_static_admin_session',
            JSON.stringify({ id: matched.id, username: matched.username, full_name: matched.full_name, role: matched.role })
          );
          window.location.href = '/admin/index.html';
          return;
        }
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Authentication failed.');
        }
        window.location.href = '/admin';
      } catch (err) {
        errBox.textContent = err.message || 'Invalid credentials.';
        errBox.classList.remove('hidden');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Sign In to Admin Panel';
      }
    });
  }
})();
