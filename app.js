const authScreen = document.getElementById('auth-screen');
const chatScreen = document.getElementById('chat-screen');
const authMessage = document.getElementById('auth-message');
const contactList = document.getElementById('contact-list');
const groupList = document.getElementById('group-list');
const messagesEl = document.getElementById('messages');
const chatTitle = document.getElementById('chat-title');
const typingIndicator = document.getElementById('typing-indicator');
const messageInput = document.getElementById('message-input');
const addContactInput = document.getElementById('add-contact-input');
const groupNameInput = document.getElementById('group-name-input');
const groupMembersSelect = document.getElementById('group-members');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const profileName = document.getElementById('profile-name');
const profileStatus = document.getElementById('profile-status');
const profileToggleBtn = document.getElementById('profile-toggle-btn');
const profilePanel = document.getElementById('profile-panel');
const profileNameInput = document.getElementById('profile-name-input');
const profileStatusInput = document.getElementById('profile-status-input');
const saveProfileBtn = document.getElementById('save-profile-btn');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const logoutBtn = document.getElementById('logout-btn');
const messageForm = document.getElementById('message-form');
const addContactBtn = document.getElementById('add-contact-btn');
const createGroupBtn = document.getElementById('create-group-btn');
const voiceBtn = document.getElementById('voice-btn');
const introOverlay = document.getElementById('intro-overlay');
const tabs = document.querySelectorAll('.tab');
const navButtons = document.querySelectorAll('.nav-btn');
const navSections = document.querySelectorAll('.nav-section');
const assistantForm = document.getElementById('assistant-form');
const assistantInput = document.getElementById('assistant-input');
const assistantMessages = document.getElementById('assistant-messages');

const SESSION_KEY = 'teto-session';

let currentUser = null;
let selectedChat = null;
let allUsers = [];
let allGroups = [];
let mediaRecorder = null;
let audioChunks = [];
let recorderStream = null;
let isRecording = false;
let refreshTimer = null;
let typingStopTimer = null;
let lastTypingState = false;
let messagesRequestId = 0;
let renderedMessagesSignature = '';

async function apiFetch(path, options = {}) {
  const apiBase = window.location.protocol === 'file:' ? 'http://localhost:3000/api' : '/api';
  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    });
  } catch (error) {
    throw new Error(window.location.protocol === 'file:'
      ? 'افتح التطبيق من الرابط العام أو شغّل الخادم المحلي على localhost:3000.'
      : 'تعذر الاتصال بالخادم. حاول تحديث الصفحة.');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }

  return payload;
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function showMessage(text, isError = false) {
  authMessage.textContent = text;
  authMessage.style.color = isError ? '#fca5a5' : '#fcd34d';
}

function switchView(view) {
  const nextView = view === 'register' ? 'register' : 'login';
  tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === nextView);
  });

  loginForm.classList.toggle('active', nextView === 'login');
  registerForm.classList.toggle('active', nextView === 'register');
  document.getElementById('otp-panel').classList.remove('active');
  authMessage.textContent = '';
}

function normalizeUser(user) {
  if (!user) return null;
  return {
    ...user,
    contacts: Array.isArray(user.contacts) ? user.contacts : [],
    status: user.status || 'متصل الآن',
    verified: Boolean(user.verified),
  };
}

function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(normalizeUser(user)));
}

function loadSession() {
  try {
    return normalizeUser(JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'));
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function setLoggedIn(user) {
  currentUser = normalizeUser(user);
  saveSession(currentUser);
  authScreen.classList.add('hidden');
  chatScreen.classList.remove('hidden');
  renderUserProfile();
  renderGroupMembers();
  renderSidebar();
}

function renderUserProfile() {
  if (!currentUser) return;
  profileName.textContent = currentUser.name;
  profileStatus.textContent = currentUser.status || 'متصل الآن';
  document.getElementById('status-input').value = currentUser.status || 'متصل الآن';
}

function logout() {
  clearSession();
  currentUser = null;
  selectedChat = null;
  chatTitle.textContent = 'Select a chat';
  messagesEl.innerHTML = '';
  authScreen.classList.remove('hidden');
  chatScreen.classList.add('hidden');
  showMessage('Logged out successfully.');
}

async function refreshUsers() {
  try {
    const data = await apiFetch('/users');
    allUsers = data.users || [];
    return allUsers;
  } catch (error) {
    console.error(error);
    return [];
  }
}

async function refreshGroups() {
  if (!currentUser) return [];
  try {
    const data = await apiFetch(`/groups?userId=${currentUser.id}`);
    allGroups = data.groups || [];
    return allGroups;
  } catch (error) {
    console.error(error);
    return [];
  }
}

async function registerUser(event) {
  event.preventDefault();

  const name = document.getElementById('register-name').value.trim();
  const phone = document.getElementById('register-phone').value.trim();
  const password = document.getElementById('register-password').value;

  if (!name || !phone || !password) {
    showMessage('Please fill in all fields.', true);
    return;
  }

  try {
    const result = await apiFetch('/register', {
      method: 'POST',
      body: JSON.stringify({ name, phone, password }),
    });

    loginForm.reset();
    registerForm.reset();
    document.getElementById('otp-code').value = '';
    document.getElementById('login-phone').value = phone;
    document.getElementById('login-password').value = password;
    document.getElementById('otp-panel').classList.add('active');
    document.getElementById('register-form').classList.remove('active');
    document.getElementById('login-form').classList.remove('active');
    switchView('login');
    showMessage(`تم إنشاء الحساب. استخدم رمز التحقق: ${result.otp || 'الرمز المرسل لك'}`);
    await refreshUsers();
  } catch (error) {
    showMessage(error.message || 'Registration failed.', true);
  }
}

async function loginUser(event) {
  event.preventDefault();

  const phone = document.getElementById('login-phone').value.trim();
  const password = document.getElementById('login-password').value;

  if (!phone || !password) {
    showMessage('Please fill in all fields.', true);
    return;
  }

  try {
    const result = await apiFetch('/login', {
      method: 'POST',
      body: JSON.stringify({ phone, password }),
    });

    setLoggedIn(result.user);
    await refreshUsers();
    await refreshGroups();
    renderGroupMembers();
    renderSidebar();
  } catch (error) {
    if (error.message.includes('OTP')) {
      showMessage('Please verify your phone with the OTP first.', true);
      document.getElementById('otp-panel').classList.add('active');
      document.getElementById('login-form').classList.remove('active');
      return;
    }

    showMessage(error.message || 'Login failed.', true);
  }
}

async function verifyOtp() {
  const code = document.getElementById('otp-code').value.trim();
  const phone = document.getElementById('login-phone').value.trim();

  if (!code || !phone) {
    showMessage('Enter the verification code and phone number.', true);
    return;
  }

  try {
    const result = await apiFetch('/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    });

    showMessage('Phone verified successfully. You can now login.');
    document.getElementById('otp-panel').classList.remove('active');
    switchView('login');
    loginForm.reset();
    document.getElementById('login-phone').value = phone;
    document.getElementById('login-password').value = '';
    setLoggedIn(result.user);
  } catch (error) {
    showMessage(error.message || 'Verification failed.', true);
  }
}

function renderGroupMembers() {
  if (!currentUser) return;

  groupMembersSelect.innerHTML = '';
  allUsers
    .filter((user) => user.id !== currentUser.id)
    .forEach((user) => {
      const option = document.createElement('option');
      option.value = user.id;
      option.textContent = `${user.name} (${user.phone})`;
      groupMembersSelect.appendChild(option);
    });
}

async function addContact() {
  if (!currentUser) return;

  const phone = addContactInput.value.trim();
  if (!phone) {
    showMessage('Enter a phone number.', true);
    return;
  }

  const found = allUsers.find((user) => user.phone === phone && user.id !== currentUser.id);

  if (!found) {
    showMessage('This number is not registered yet.', true);
    return;
  }

  const userHasContact = currentUser.contacts && currentUser.contacts.includes(found.id);
  if (userHasContact) {
    showMessage('This contact is already in your list.', true);
    return;
  }

  try {
    const result = await apiFetch('/contacts', {
      method: 'POST',
      body: JSON.stringify({ userId: currentUser.id, contactId: found.id }),
    });

    currentUser = normalizeUser(result.user);
    saveSession(currentUser);
    addContactInput.value = '';
    await refreshUsers();
    renderSidebar();
    renderUserProfile();
    showMessage('Contact added successfully.');
  } catch (error) {
    showMessage(error.message || 'Could not add contact.', true);
  }
}

async function createGroup() {
  if (!currentUser) return;

  const name = groupNameInput.value.trim();
  const selected = Array.from(groupMembersSelect.selectedOptions).map((option) => option.value);

  if (!name) {
    showMessage('Group name is required.', true);
    return;
  }

  try {
    const result = await apiFetch('/groups', {
      method: 'POST',
      body: JSON.stringify({ userId: currentUser.id, name, members: selected }),
    });

    groupNameInput.value = '';
    Array.from(groupMembersSelect.options).forEach((option) => option.selected = false);
    await refreshGroups();
    renderSidebar();
    showMessage(result.group ? 'Group created successfully.' : 'Group created successfully with you only.');
    selectChat('group', result.group.id);
  } catch (error) {
    showMessage(error.message || 'Could not create group.', true);
  }
}

async function renderSidebar() {
  if (!currentUser) return;

  try {
    const result = await apiFetch(`/chats?userId=${currentUser.id}`);
    const chats = result.chats || [];

    const directChats = chats.filter((item) => item.type === 'user');
    const groupChats = chats.filter((item) => item.type === 'group');

    contactList.innerHTML = '';
    if (!directChats.length) {
      contactList.innerHTML = '<p class="empty-state">لا توجد محادثات بعد.</p>';
    } else {
      directChats.forEach((item) => {
        const user = item.user;
        const button = document.createElement('button');
        button.className = `contact-card ${selectedChat && selectedChat.type === 'user' && selectedChat.id === user.id ? 'active' : ''}`;
        button.type = 'button';
        button.setAttribute('aria-label', `فتح محادثة ${user.name}`);
        button.innerHTML = `
          <div class="contact-meta">
            <span class="contact-name">${user.name}</span>
            <span class="contact-last">${formatLastMessage(item.lastMessage)}</span>
          </div>
        `;
        button.addEventListener('click', () => selectChat('user', user.id));
        contactList.appendChild(button);
      });
    }

    groupList.innerHTML = '';
    if (!groupChats.length) {
      groupList.innerHTML = '<p class="empty-state">لا توجد مجموعات بعد.</p>';
    } else {
      groupChats.forEach((item) => {
        const group = item.group;
        const button = document.createElement('button');
        button.className = `contact-card ${selectedChat && selectedChat.type === 'group' && selectedChat.id === group.id ? 'active' : ''}`;
        button.type = 'button';
        button.setAttribute('aria-label', `فتح مجموعة ${group.name}`);
        button.innerHTML = `
          <div class="contact-meta">
            <span class="contact-name">${group.name}</span>
            <span class="contact-last">${formatLastMessage(item.lastMessage)}</span>
          </div>
        `;
        button.addEventListener('click', () => selectChat('group', group.id));
        groupList.appendChild(button);
      });
    }
  } catch (error) {
    console.error(error);
  }
}

function formatLastMessage(message) {
  if (!message) return 'ابدأ المحادثة';
  if (message.deletedForEveryone) return 'تم حذف رسالة';
  if (message.audio) return 'رسالة صوتية';
  return message.text || 'رسالة جديدة';
}

function selectChat(type, id) {
  selectedChat = { type, id };
  renderedMessagesSignature = '';
  stopTyping();
  typingIndicator.textContent = '';

  if (type === 'user') {
    const user = allUsers.find((entry) => entry.id === id);
    chatTitle.textContent = user ? user.name : 'Select a chat';
  } else {
    const group = allGroups.find((entry) => entry.id === id);
    chatTitle.textContent = group ? group.name : 'Select a group';
  }

  renderSidebar();
  loadMessages();
}

async function updateTyping(isTyping) {
  if (!currentUser || !selectedChat || lastTypingState === isTyping) return;
  lastTypingState = isTyping;
  try {
    await apiFetch('/typing', {
      method: 'POST',
      body: JSON.stringify({
        userId: currentUser.id,
        chatType: selectedChat.type,
        chatId: selectedChat.id,
        isTyping,
      }),
    });
  } catch (error) {
    console.error(error);
  }
}

function stopTyping() {
  if (typingStopTimer) window.clearTimeout(typingStopTimer);
  typingStopTimer = null;
  if (lastTypingState) updateTyping(false);
  lastTypingState = false;
}

async function refreshTypingIndicator() {
  if (!currentUser || !selectedChat) return;
  try {
    const result = await apiFetch(`/typing?userId=${encodeURIComponent(currentUser.id)}&chatType=${selectedChat.type}&chatId=${encodeURIComponent(selectedChat.id)}`);
    const typingUsers = result.userIds || [];
    if (!typingUsers.length) {
      typingIndicator.textContent = '';
      return;
    }
    const names = typingUsers
      .map((id) => allUsers.find((user) => user.id === id)?.name)
      .filter(Boolean);
    typingIndicator.textContent = names.length > 1 ? `${names.join(' و ')} يكتبون الآن...` : `${names[0] || 'الطرف الآخر'} يكتب الآن...`;
  } catch (error) {
    console.error(error);
  }
}

async function loadMessages() {
  if (!currentUser || !selectedChat) {
    messagesEl.innerHTML = '';
    return;
  }

  try {
    const requestId = ++messagesRequestId;
    const chatSnapshot = `${selectedChat.type}:${selectedChat.id}`;
    if (selectedChat.type === 'user') {
      const result = await apiFetch(`/messages?userId=${currentUser.id}&contactId=${selectedChat.id}`);
      const messages = result.messages || [];
      if (requestId !== messagesRequestId || !selectedChat || `${selectedChat.type}:${selectedChat.id}` !== chatSnapshot) return;
      renderMessageList(messages, 'user');
      return;
    }

    const result = await apiFetch(`/group-messages?groupId=${encodeURIComponent(selectedChat.id)}&userId=${encodeURIComponent(currentUser.id)}`);
    const messages = result.messages || [];
    if (requestId !== messagesRequestId || !selectedChat || `${selectedChat.type}:${selectedChat.id}` !== chatSnapshot) return;
    renderMessageList(messages, 'group');
  } catch (error) {
    console.error(error);
    messagesEl.innerHTML = '<div class="empty-state">تعذر تحميل الرسائل.</div>';
  }
}

function renderMessageList(messages, type) {
  const signature = messages.map((message) => `${message.id}:${message.text}:${message.audio || ''}:${message.editedAt || ''}:${message.deletedForEveryone ? 'deleted' : ''}`).join('|');
  if (signature === renderedMessagesSignature) return;
  renderedMessagesSignature = signature;
  messagesEl.innerHTML = '';

  if (!messages.length) {
    messagesEl.innerHTML = '<div class="empty-state">لا توجد رسائل</div>';
    return;
  }

  messages.forEach((message) => {
    const row = document.createElement('div');
    const fromMe = message.senderId === currentUser.id;
    row.className = `message-row ${fromMe ? 'outgoing' : 'incoming'}`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    if (message.deletedForEveryone) {
      const deletedText = document.createElement('em');
      deletedText.className = 'deleted-message';
      deletedText.textContent = 'تم حذف هذه الرسالة';
      bubble.appendChild(deletedText);
    } else if (message.audio) {
      const voiceWrap = document.createElement('div');
      voiceWrap.className = 'voice-message';
      const voiceIcon = document.createElement('span');
      voiceIcon.className = 'voice-wave-icon';
      voiceIcon.textContent = '⌁';
      voiceWrap.appendChild(voiceIcon);

      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.setAttribute('aria-label', 'تشغيل الرسالة الصوتية');
      audio.src = message.audio;
      audio.addEventListener('error', () => {
        const errorText = document.createElement('small');
        errorText.className = 'audio-error';
        errorText.textContent = 'تعذر تشغيل هذه الرسالة الصوتية';
        voiceWrap.appendChild(errorText);
      }, { once: true });
      voiceWrap.appendChild(audio);
      bubble.appendChild(voiceWrap);
    }

    if (!message.deletedForEveryone && message.text) {
      const textNode = document.createElement('div');
      textNode.textContent = type === 'group'
        ? `${allUsers.find((user) => user.id === message.senderId)?.name || 'User'}: ${message.text}`
        : message.text;
      bubble.appendChild(textNode);
      if (message.editedAt) {
        const editedLabel = document.createElement('small');
        editedLabel.className = 'edited-label';
        editedLabel.textContent = 'معدلة';
        bubble.appendChild(editedLabel);
      }
    }

    if (!message.deletedForEveryone) {
      const actions = document.createElement('div');
      actions.className = 'message-actions';
      const deleteForMe = document.createElement('button');
      deleteForMe.type = 'button';
      deleteForMe.textContent = 'حذف عندي';
      deleteForMe.addEventListener('click', () => deleteMessage(message.id, 'me'));
      actions.appendChild(deleteForMe);
      if (fromMe) {
        if (message.text) {
          const editButton = document.createElement('button');
          editButton.type = 'button';
          editButton.textContent = 'تعديل';
          editButton.addEventListener('click', () => editMessage(message));
          actions.appendChild(editButton);
        }
        const deleteForEveryone = document.createElement('button');
        deleteForEveryone.type = 'button';
        deleteForEveryone.textContent = 'حذف للجميع';
        deleteForEveryone.addEventListener('click', () => deleteMessage(message.id, 'everyone'));
        actions.appendChild(deleteForEveryone);
      }
      bubble.appendChild(actions);
    }

    row.appendChild(bubble);
    messagesEl.appendChild(row);
  });

  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function editMessage(message) {
  const text = window.prompt('عدّل الرسالة:', message.text);
  if (text === null || !text.trim() || text.trim() === message.text) return;

  try {
    await apiFetch(`/messages/${encodeURIComponent(message.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ userId: currentUser.id, text: text.trim() }),
    });
    await Promise.all([loadMessages(), renderSidebar()]);
  } catch (error) {
    showMessage(error.message || 'تعذر تعديل الرسالة.', true);
  }
}

async function deleteChat() {
  if (!currentUser || !selectedChat) return;
  const title = chatTitle.textContent || 'هذه الدردشة';
  if (!window.confirm(`حذف دردشة ${title} من قائمتك؟`)) return;

  try {
    await apiFetch('/chats/hide', {
      method: 'POST',
      body: JSON.stringify({ userId: currentUser.id, chatId: selectedChat.id }),
    });
    selectedChat = null;
    renderedMessagesSignature = '';
    messagesEl.innerHTML = '<div class="empty-state">اختر محادثة للبدء</div>';
    chatTitle.textContent = 'اختر محادثة';
    await renderSidebar();
  } catch (error) {
    showMessage(error.message || 'تعذر حذف الدردشة.', true);
  }
}

async function deleteMessage(messageId, mode) {
  const prompt = mode === 'everyone'
    ? 'حذف الرسالة من عندك ومن جميع الأطراف؟'
    : 'حذف الرسالة من عندك فقط؟';
  if (!window.confirm(prompt)) return;

  try {
    await apiFetch(`/messages/${encodeURIComponent(messageId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ userId: currentUser.id, mode }),
    });
    await loadMessages();
    await renderSidebar();
  } catch (error) {
    showMessage(error.message || 'تعذر حذف الرسالة.', true);
  }
}

async function sendAudioMessage(audioDataUrl) {
  if (!currentUser || !selectedChat) return;

  voiceBtn.disabled = true;
  voiceBtn.classList.add('sending');
  showMessage('جاري إرسال الرسالة الصوتية...');

  try {
    if (selectedChat.type === 'user') {
      await apiFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({
          senderId: currentUser.id,
          receiverId: selectedChat.id,
          type: 'voice',
          audio: audioDataUrl,
        }),
      });
    } else {
      await apiFetch('/messages/group', {
        method: 'POST',
        body: JSON.stringify({
          senderId: currentUser.id,
          groupId: selectedChat.id,
          type: 'voice',
          audio: audioDataUrl,
        }),
      });
    }

    await Promise.all([loadMessages(), renderSidebar()]);
  } catch (error) {
    showMessage(error.message || 'Could not send voice message.', true);
  } finally {
    voiceBtn.disabled = false;
    voiceBtn.classList.remove('sending');
  }
}

async function sendMessage(event) {
  event.preventDefault();

  if (!currentUser || !selectedChat) return;

  const text = messageInput.value.trim();
  if (!text) return;

  messageInput.value = '';

  try {
    if (selectedChat.type === 'user') {
      await apiFetch('/messages', {
        method: 'POST',
        body: JSON.stringify({ senderId: currentUser.id, receiverId: selectedChat.id, text }),
      });
    } else {
      await apiFetch('/messages/group', {
        method: 'POST',
        body: JSON.stringify({ senderId: currentUser.id, groupId: selectedChat.id, text }),
      });
    }

    await Promise.all([loadMessages(), renderSidebar()]);
  } catch (error) {
    messageInput.value = text;
    showMessage(error.message || 'Could not send message.', true);
  }
}

async function askAssistant(event) {
  event.preventDefault();
  const prompt = assistantInput.value.trim();
  if (!prompt) return;
  const userMessage = document.createElement('p');
  userMessage.className = 'assistant-user';
  userMessage.textContent = prompt;
  assistantMessages.appendChild(userMessage);
  assistantInput.value = '';
  try {
    const result = await apiFetch('/assistant', { method: 'POST', body: JSON.stringify({ prompt }) });
    const reply = document.createElement('p');
    reply.textContent = `TETO: ${result.reply}`;
    assistantMessages.appendChild(reply);
  } catch (error) {
    const reply = document.createElement('p');
    reply.textContent = error.message || 'تعذر تشغيل المساعد الآن.';
    assistantMessages.appendChild(reply);
  }
  assistantMessages.scrollTop = assistantMessages.scrollHeight;
}

async function saveStatus() {
  if (!currentUser) return;

  const status = document.getElementById('status-input').value.trim() || 'متصل الآن';

  try {
    const result = await apiFetch('/profile', {
      method: 'PUT',
      body: JSON.stringify({ userId: currentUser.id, status }),
    });

    currentUser = normalizeUser(result.user);
    saveSession(currentUser);
    renderUserProfile();
    showMessage('تم حفظ الحالة.');
  } catch (error) {
    showMessage(error.message || 'Could not save status.', true);
  }
}

async function saveProfile() {
  if (!currentUser) return;

  const name = profileNameInput.value.trim() || currentUser.name;
  const status = profileStatusInput.value.trim() || currentUser.status || 'متصل الآن';

  try {
    const result = await apiFetch('/profile', {
      method: 'PUT',
      body: JSON.stringify({ userId: currentUser.id, name, status }),
    });

    currentUser = normalizeUser(result.user);
    saveSession(currentUser);
    renderUserProfile();
    await refreshUsers();
    renderSidebar();
    showMessage('تم تحديث الملف الشخصي.');
  } catch (error) {
    showMessage(error.message || 'Could not save profile.', true);
  }
}

function renderSearchResults() {
  if (!currentUser) {
    searchResults.innerHTML = '';
    return;
  }

  const query = searchInput.value.trim().toLowerCase();
  if (!query) {
    searchResults.innerHTML = '';
    return;
  }

  const filtered = allUsers.filter((user) => {
    if (user.id === currentUser.id) return false;
    const haystack = `${user.name} ${user.phone}`.toLowerCase();
    return haystack.includes(query);
  });

  if (!filtered.length) {
    searchResults.innerHTML = '<span class="empty-state">لا توجد نتائج</span>';
    return;
  }

  searchResults.innerHTML = filtered.map((user) => {
    const isContact = currentUser.contacts && currentUser.contacts.includes(user.id);
    return `
      <div class="search-item">
        <div>
          <strong>${user.name}</strong><br />
          <small>${user.phone}</small>
        </div>
        <button type="button" data-user-id="${user.id}" class="mini-search-btn">${isContact ? 'فتح' : 'إضافة'}</button>
      </div>
    `;
  }).join('');

  searchResults.querySelectorAll('.mini-search-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.getAttribute('data-user-id');
      const user = allUsers.find((entry) => entry.id === userId);
      if (!user) return;

      if (currentUser.contacts && currentUser.contacts.includes(userId)) {
        selectChat('user', userId);
        return;
      }

      try {
        const result = await apiFetch('/contacts', {
          method: 'POST',
          body: JSON.stringify({ userId: currentUser.id, contactId: userId }),
        });

        currentUser = normalizeUser(result.user);
        saveSession(currentUser);
        await refreshUsers();
        renderSidebar();
        renderUserProfile();
        selectChat('user', userId);
      } catch (error) {
        showMessage(error.message || 'Could not add contact.', true);
      }
    });
  });
}

async function bootstrap() {
  await refreshUsers();

  const savedUser = loadSession();
  const serverUser = savedUser && allUsers.find((user) => user.id === savedUser.id);
  if (serverUser) {
    currentUser = normalizeUser(serverUser);
    authScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    renderUserProfile();
    await refreshUsers();
    await refreshGroups();
    renderGroupMembers();
    renderSidebar();

    if (!selectedChat) {
      const firstContactId = currentUser.contacts[0];
      const firstGroup = allGroups.find((group) => group.members.includes(currentUser.id));
      if (firstContactId) {
        selectChat('user', firstContactId);
      } else if (firstGroup) {
        selectChat('group', firstGroup.id);
      }
    }
  } else if (savedUser) {
    clearSession();
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', (event) => {
      event.preventDefault();
      switchView(tab.dataset.view);
    });
  });

  loginForm.addEventListener('submit', loginUser);
  registerForm.addEventListener('submit', registerUser);
  logoutBtn.addEventListener('click', logout);
  messageForm.addEventListener('submit', sendMessage);
  messageInput.addEventListener('input', () => {
    if (!selectedChat) return;
    updateTyping(Boolean(messageInput.value.trim()));
    if (typingStopTimer) window.clearTimeout(typingStopTimer);
    typingStopTimer = window.setTimeout(stopTyping, 1800);
  });
  assistantForm.addEventListener('submit', askAssistant);
  addContactBtn.addEventListener('click', addContact);
  createGroupBtn.addEventListener('click', createGroup);
  searchInput.addEventListener('input', renderSearchResults);
  profileToggleBtn.addEventListener('click', () => {
    profilePanel.classList.toggle('hidden');
    if (currentUser) {
      profileNameInput.value = currentUser.name;
      profileStatusInput.value = currentUser.status || 'متصل الآن';
    }
  });
  saveProfileBtn.addEventListener('click', saveProfile);
  document.getElementById('delete-chat-btn').addEventListener('click', deleteChat);
  document.getElementById('verify-otp-btn').addEventListener('click', verifyOtp);
  document.getElementById('save-status-btn').addEventListener('click', saveStatus);
  document.getElementById('status-input').value = currentUser ? currentUser.status || 'متصل الآن' : '';

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      navButtons.forEach((item) => item.classList.toggle('active', item === button));
      navSections.forEach((section) => section.classList.toggle('hidden', section.id !== button.dataset.section));
    });
  });

  voiceBtn.addEventListener('click', async () => {
    if (!currentUser || !selectedChat) {
      showMessage('Select a chat before recording a voice note.', true);
      return;
    }

    if (isRecording) {
      if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      voiceBtn.classList.remove('recording');
      isRecording = false;
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recorderStream = stream;
      audioChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''));
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        if (!audioChunks.length) {
          showMessage('لم يتم تسجيل صوت صالح.', true);
          if (recorderStream) {
            recorderStream.getTracks().forEach((track) => track.stop());
            recorderStream = null;
          }
          return;
        }
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = async () => {
          const audioDataUrl = reader.result;
          if (audioDataUrl) {
            await sendAudioMessage(audioDataUrl);
          }
          if (recorderStream) {
            recorderStream.getTracks().forEach((track) => track.stop());
            recorderStream = null;
          }
        };
        reader.readAsDataURL(audioBlob);
      };

      mediaRecorder.start();
      isRecording = true;
      voiceBtn.classList.add('recording');
      showMessage('Recording... Tap again to stop.');
    } catch (error) {
      showMessage('Microphone access is required for voice messages.', true);
    }
  });

  setTimeout(() => {
    introOverlay.classList.add('hidden');
  }, 2200);

  refreshTimer = window.setInterval(async () => {
    if (!currentUser) return;
    await refreshUsers();
    await refreshGroups();
    await renderSidebar();
    if (selectedChat) await loadMessages();
    await refreshTypingIndicator();
  }, 2500);
}

bootstrap();

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => console.error('TETO offline setup failed', error));
  });
}
