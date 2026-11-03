// Password recovery for administrators, using Supabase Auth (never database passwords).
window.setupRecovery = function setupRecovery(client) {
  if (!client || document.getElementById('recover-dialog')) return;
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'recovery.css';
  document.head.append(css);

  const login = document.getElementById('login-form');
  const forgot = document.createElement('button');
  forgot.type = 'button';
  forgot.className = 'text-button recovery-link';
  forgot.textContent = 'Esqueci minha senha';
  login.append(forgot);

  const dialog = document.createElement('dialog');
  dialog.id = 'recover-dialog';
  dialog.setAttribute('aria-labelledby', 'recovery-title');
  dialog.innerHTML = `
    <button type="button" class="close" id="close-recovery" aria-label="Fechar">×</button>
    <div class="admin-wrap">
      <span class="eyebrow muted">ÁREA RESTRITA</span>
      <h2 id="recovery-title">Recuperar <em>senha.</em></h2>
      <p id="recovery-message" class="recovery-explanation" role="status" aria-live="polite"></p>
      <form id="request-recovery">
        <label>E-mail do administrador<input type="email" id="recovery-email" required autocomplete="email" placeholder="seu@email.com"></label>
        <button class="btn btn-primary" type="submit">Enviar link de recuperação ↗</button>
      </form>
      <form id="set-password" hidden>
        <label>Nova senha<input type="password" id="new-password" minlength="8" autocomplete="new-password" required></label>
        <label>Confirme a nova senha<input type="password" id="confirm-password" minlength="8" autocomplete="new-password" required></label>
        <button class="btn btn-primary" type="submit">Salvar nova senha ↗</button>
      </form>
      <button class="text-button recovery-back" type="button" id="recovery-back">Voltar ao login</button>
    </div>`;
  document.body.append(dialog);
  const el = (id) => document.getElementById(id);
  const message = el('recovery-message');
  const request = el('request-recovery');
  const change = el('set-password');
  function openRecovery(canChange) {
    request.hidden = canChange;
    change.hidden = !canChange;
    message.textContent = canChange
      ? 'Escolha uma senha nova para acessar o painel administrativo.'
      : 'Informe seu e-mail para receber um link de recuperação.';
    if (document.getElementById('admin-dialog').open) document.getElementById('admin-dialog').close();
    if (!dialog.open) dialog.showModal();
  }

  forgot.addEventListener('click', () => {
    el('recovery-email').value = el('admin-email').value.trim();
    openRecovery(false);
  });
  el('close-recovery').addEventListener('click', () => dialog.close());
  el('recovery-back').addEventListener('click', () => {
    dialog.close();
    if (!document.getElementById('admin-dialog').open) document.getElementById('admin-dialog').showModal();
  });

  request.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = request.querySelector('button[type="submit"]');
    button.disabled = true;
    const { error } = await client.auth.resetPasswordForEmail(el('recovery-email').value.trim(), {
      redirectTo: `${location.origin}${location.pathname}`
    });
    button.disabled = false;
    message.textContent = error
      ? 'Não foi possível solicitar o link agora. Aguarde um pouco e tente novamente.'
      : 'Se o e-mail estiver cadastrado, você receberá um link. Use o link mais recente e confira também o spam.';
  });

  change.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = el('new-password').value;
    if (password !== el('confirm-password').value) {
      message.textContent = 'As senhas não coincidem. Digite novamente.';
      return;
    }
    const button = change.querySelector('button[type="submit"]');
    button.disabled = true;
    const { error } = await client.auth.updateUser({ password });
    button.disabled = false;
    if (error) {
      message.textContent = 'Não foi possível trocar a senha. O link pode ter expirado; solicite outro.';
      return;
    }
    await client.auth.signOut();
    change.reset();
    dialog.close();
    document.getElementById('admin-dialog').showModal();
    document.getElementById('admin-password').value = '';
    const notice = document.getElementById('admin-message');
    notice.textContent = 'Senha atualizada! Entre com seu e-mail e a nova senha.';
    notice.hidden = false;
    history.replaceState(null, '', location.pathname + location.search);
  });

  // Supabase emits PASSWORD_RECOVERY after validating the emailed token.
  client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') openRecovery(true);
  });
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('error') || params.get('error_code')) {
    openRecovery(false);
    message.textContent = 'Esse link expirou ou já foi utilizado. Solicite um novo link de recuperação.';
    history.replaceState(null, '', location.pathname + location.search);
  }
};

// This script loads after app.js. Its init() starts before its first await.
if (typeof db !== 'undefined' && db) window.setupRecovery(db);
