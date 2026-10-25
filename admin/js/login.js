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
