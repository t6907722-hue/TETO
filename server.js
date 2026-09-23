const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  });
}

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');
const typingStates = new Map();

app.use(express.json({ limit: '15mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    const now = new Date().toISOString();
    const seed = {
      users: [],
      groups: [],
      messages: [],
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
  }
}

function readDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (error) {
    return { users: [], groups: [], messages: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function randomId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeContactList(value) {
  return Array.isArray(value) ? value : [];
}

function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    phone: user.phone,
    status: user.status || 'متصل الآن',
    contacts: normalizeContactList(user.contacts),
    hiddenChats: normalizeContactList(user.hiddenChats),
    verified: Boolean(user.verified),
    createdAt: user.createdAt,
  };
}

function sortByTime(a, b) {
  return new Date(a.createdAt) - new Date(b.createdAt);
}

function visibleMessages(messages, userId) {
  return messages.filter((message) => !(message.deletedFor || []).includes(String(userId)));
}

function typingKey(chatType, userId, chatId) {
  if (chatType === 'user') {
    return `${chatType}:${[String(userId), String(chatId)].sort().join(':')}`;
  }
  return `${chatType}:${chatId}`;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'TETO app is running' });
});

app.post('/api/register', (req, res) => {
  const { name, phone, password } = req.body || {};

  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'Name, phone, and password are required.' });
  }

  const db = readDb();
  const phoneExists = db.users.some((user) => user.phone === String(phone).trim());

  if (phoneExists) {
    return res.status(409).json({ error: 'Phone number already registered.' });
  }

  const user = {
    id: randomId('user'),
    name: String(name).trim(),
    phone: String(phone).trim(),
    password: String(password),
    status: 'متصل الآن',
    contacts: [],
    verified: false,
    otp: String(crypto.randomInt(100000, 1000000)),
    createdAt: new Date().toISOString(),
  };

  db.users.push(user);
  writeDb(db);

  res.status(201).json({ user: safeUser(user), otp: user.otp });
});

app.post('/api/login', (req, res) => {
  const { phone, password } = req.body || {};

  if (!phone || !password) {
    return res.status(400).json({ error: 'Phone and password are required.' });
  }

  const db = readDb();
  const user = db.users.find(
    (entry) => entry.phone === String(phone).trim() && entry.password === String(password)
  );

  if (!user) {
    return res.status(401).json({ error: 'Invalid phone number or password.' });
  }

  if (!user.verified) {
    return res.status(403).json({ error: 'OTP verification required.', needsOtp: true });
  }

  res.json({ user: safeUser(user) });
});

app.post('/api/verify-otp', (req, res) => {
  const { phone, code } = req.body || {};

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone and OTP code are required.' });
  }

  const db = readDb();
  const user = db.users.find((entry) => entry.phone === String(phone).trim());

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (String(code) !== String(user.otp)) {
    return res.status(400).json({ error: 'Incorrect verification code.' });
  }

  user.verified = true;
  writeDb(db);

  res.json({ user: safeUser(user) });
});

app.get('/api/users', (req, res) => {
  const db = readDb();
  const users = db.users.map(safeUser);
  res.json({ users });
});

app.get('/api/groups', (req, res) => {
  const { userId } = req.query;
  const db = readDb();

  if (!userId) {
    return res.json({ groups: db.groups || [] });
  }

  const groups = (db.groups || []).filter((group) => group.members.includes(String(userId)));
  res.json({ groups });
});

app.post('/api/groups', (req, res) => {
  const { userId, name, members = [] } = req.body || {};

  if (!userId || !name) {
    return res.status(400).json({ error: 'userId and group name are required.' });
  }

  const db = readDb();
  const creator = db.users.find((user) => user.id === String(userId));
  const validMembers = members.map(String).filter((memberId) => db.users.some((user) => user.id === memberId));
  if (!creator) {
    return res.status(404).json({ error: 'User not found.' });
  }
  const group = {
    id: randomId('group'),
    name: String(name).trim(),
    members: Array.from(new Set([String(userId), ...validMembers])),
    createdBy: String(userId),
    createdAt: new Date().toISOString(),
  };

  db.groups.push(group);
  writeDb(db);

  res.status(201).json({ group });
});

app.get('/api/chats', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }

  const db = readDb();
  const currentUser = db.users.find((user) => user.id === String(userId));

  if (!currentUser) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const directContacts = (db.users || [])
    .filter((user) => {
      if (user.id === String(userId)) return false;
      if (normalizeContactList(currentUser.hiddenChats).includes(user.id)) return false;
      const isContact = normalizeContactList(currentUser.contacts).includes(user.id);
      const hasMessages = (db.messages || []).some((message) =>
        (message.senderId === String(userId) && message.receiverId === user.id) ||
        (message.senderId === user.id && message.receiverId === String(userId))
      );
      return isContact || hasMessages;
    })
    .map((user) => {
      const relatedMessages = visibleMessages(db.messages || [], userId).filter(
        (message) =>
          (message.senderId === String(userId) && message.receiverId === user.id) ||
          (message.senderId === user.id && message.receiverId === String(userId))
      );
      return {
        type: 'user',
        user: safeUser(user),
        lastMessage: relatedMessages.sort(sortByTime).slice(-1)[0] || null,
      };
    });

  const groupChats = (db.groups || [])
    .filter((group) => group.members.includes(String(userId)) && !normalizeContactList(currentUser.hiddenChats).includes(group.id))
    .map((group) => {
      const relatedMessages = visibleMessages(db.messages || [], userId).filter((message) => message.type === 'group' && message.groupId === group.id);
      return {
        type: 'group',
        group,
        lastMessage: relatedMessages.sort(sortByTime).slice(-1)[0] || null,
      };
    });

  res.json({ chats: [...directContacts, ...groupChats] });
});

app.get('/api/messages', (req, res) => {
  const { userId, contactId } = req.query;
  if (!userId || !contactId) {
    return res.status(400).json({ error: 'userId and contactId are required.' });
  }

  const db = readDb();
  const messages = visibleMessages(db.messages || [], userId)
    .filter(
      (message) =>
        ((message.type === 'user' || message.type === 'voice') &&
          ((message.senderId === String(userId) && message.receiverId === String(contactId)) ||
          (message.senderId === String(contactId) && message.receiverId === String(userId))))
    )
    .sort(sortByTime);

  res.json({ messages });
});

app.delete('/api/messages/:messageId', (req, res) => {
  const { messageId } = req.params;
  const { userId, mode = 'me' } = req.body || {};
  if (!messageId || !userId) {
    return res.status(400).json({ error: 'messageId and userId are required.' });
  }

  const db = readDb();
  const message = (db.messages || []).find((entry) => entry.id === String(messageId));
  if (!message) return res.status(404).json({ error: 'Message not found.' });

  const isParticipant = message.senderId === String(userId)
    || message.receiverId === String(userId)
    || (message.groupId && (db.groups || []).some((group) => group.id === message.groupId && group.members.includes(String(userId))));
  if (!isParticipant) return res.status(403).json({ error: 'You cannot delete this message.' });

  if (mode === 'everyone') {
    if (message.senderId !== String(userId)) {
      return res.status(403).json({ error: 'Only the sender can delete for everyone.' });
    }
    message.deletedForEveryone = true;
    message.text = '';
    message.audio = null;
    message.deletedAt = new Date().toISOString();
  } else {
    message.deletedFor = Array.from(new Set([...(message.deletedFor || []), String(userId)]));
  }

  writeDb(db);
  res.json({ ok: true, message });
});

app.put('/api/messages/:messageId', (req, res) => {
  const { messageId } = req.params;
  const { userId, text } = req.body || {};
  const finalText = String(text || '').trim();
  if (!messageId || !userId || !finalText) {
    return res.status(400).json({ error: 'messageId, userId, and text are required.' });
  }

  const db = readDb();
  const message = (db.messages || []).find((entry) => entry.id === String(messageId));
  if (!message) return res.status(404).json({ error: 'Message not found.' });
  if (message.senderId !== String(userId)) return res.status(403).json({ error: 'Only the sender can edit this message.' });
  if (message.audio) return res.status(400).json({ error: 'Voice messages cannot be edited.' });
  if (message.deletedForEveryone) return res.status(400).json({ error: 'Deleted messages cannot be edited.' });

  message.text = finalText;
  message.editedAt = new Date().toISOString();
  writeDb(db);
  res.json({ ok: true, message });
});

app.delete('/api/chats', (req, res) => {
  const { userId, chatId } = req.body || {};
  if (!userId || !chatId) return res.status(400).json({ error: 'userId and chatId are required.' });

  const db = readDb();
  const user = (db.users || []).find((entry) => entry.id === String(userId));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.hiddenChats = Array.from(new Set([...(user.hiddenChats || []), String(chatId)]));
  writeDb(db);
  res.json({ ok: true, user: safeUser(user) });
});

app.post('/api/chats/hide', (req, res) => {
  const { userId, chatId } = req.body || {};
  if (!userId || !chatId) return res.status(400).json({ error: 'userId and chatId are required.' });

  const db = readDb();
  const user = (db.users || []).find((entry) => entry.id === String(userId));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  user.hiddenChats = Array.from(new Set([...(user.hiddenChats || []), String(chatId)]));
  writeDb(db);
  res.json({ ok: true, user: safeUser(user) });
});

app.post('/api/messages', (req, res) => {
  const { senderId, receiverId, text, audio, type } = req.body || {};
  if (!senderId || !receiverId) {
    return res.status(400).json({ error: 'senderId and receiverId are required.' });
  }

  const finalText = text ? String(text).trim() : '';
  const finalAudio = audio ? String(audio) : '';

  if (finalAudio && !/^data:audio\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(finalAudio)) {
    return res.status(400).json({ error: 'Invalid audio message.' });
  }

  if (!finalText && !finalAudio) {
    return res.status(400).json({ error: 'Message text or audio is required.' });
  }

  const db = readDb();
  const sender = db.users.find((user) => user.id === String(senderId));
  const receiver = db.users.find((user) => user.id === String(receiverId));
  if (!sender || !receiver) {
    return res.status(404).json({ error: 'Sender or receiver not found.' });
  }

  sender.contacts = Array.from(new Set([...(sender.contacts || []), receiver.id]));
  receiver.contacts = Array.from(new Set([...(receiver.contacts || []), sender.id]));
  sender.hiddenChats = (sender.hiddenChats || []).filter((id) => id !== receiver.id);
  receiver.hiddenChats = (receiver.hiddenChats || []).filter((id) => id !== sender.id);
  const message = {
    id: randomId('msg'),
    type: type === 'voice' ? 'voice' : 'user',
    senderId: String(senderId),
    receiverId: String(receiverId),
    text: finalText,
    audio: finalAudio || null,
    createdAt: new Date().toISOString(),
  };

  db.messages.push(message);
  writeDb(db);
  res.status(201).json({ message });
});

app.post('/api/messages/group', (req, res) => {
  const { senderId, groupId, text, audio, type } = req.body || {};
  if (!senderId || !groupId) {
    return res.status(400).json({ error: 'senderId and groupId are required.' });
  }

  const db = readDb();
  const group = (db.groups || []).find((entry) => entry.id === String(groupId));
  if (!group) {
    return res.status(404).json({ error: 'Group not found.' });
  }
  if (!group.members.includes(String(senderId))) {
    return res.status(403).json({ error: 'Only group members can send messages.' });
  }

  const sender = db.users.find((user) => user.id === String(senderId));
  if (sender) sender.hiddenChats = (sender.hiddenChats || []).filter((id) => id !== group.id);

  const finalText = text ? String(text).trim() : '';
  const finalAudio = audio ? String(audio) : '';

  if (finalAudio && !/^data:audio\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i.test(finalAudio)) {
    return res.status(400).json({ error: 'Invalid audio message.' });
  }

  if (!finalText && !finalAudio) {
    return res.status(400).json({ error: 'Message text or audio is required.' });
  }

  const message = {
    id: randomId('msg'),
    type: type === 'voice' ? 'voice-group' : 'group',
    senderId: String(senderId),
    groupId: String(groupId),
    text: finalText,
    audio: finalAudio || null,
    createdAt: new Date().toISOString(),
  };

  db.messages.push(message);
  writeDb(db);
  res.status(201).json({ message });
});

app.get('/api/group-messages', (req, res) => {
  const { groupId, userId } = req.query;
  if (!groupId || !userId) {
    return res.status(400).json({ error: 'groupId and userId are required.' });
  }

  const db = readDb();
  const group = (db.groups || []).find((entry) => entry.id === String(groupId));
  if (!group || !group.members.includes(String(userId))) {
    return res.status(403).json({ error: 'Only group members can read messages.' });
  }
  const messages = visibleMessages(db.messages || [], userId)
    .filter((message) => (message.type === 'group' || message.type === 'voice-group') && message.groupId === String(groupId))
    .sort(sortByTime);

  res.json({ messages });
});

app.post('/api/typing', (req, res) => {
  const { userId, chatType, chatId, isTyping } = req.body || {};
  if (!userId || !chatType || !chatId) {
    return res.status(400).json({ error: 'userId, chatType, and chatId are required.' });
  }

  const key = typingKey(chatType, userId, chatId);
  const current = typingStates.get(key) || new Map();
  if (isTyping) {
    current.set(String(userId), Date.now() + 4500);
  } else {
    current.delete(String(userId));
  }
  typingStates.set(key, current);
  res.json({ ok: true });
});

app.get('/api/typing', (req, res) => {
  const { userId, chatType, chatId } = req.query;
  if (!userId || !chatType || !chatId) {
    return res.status(400).json({ error: 'userId, chatType, and chatId are required.' });
  }

  const current = typingStates.get(typingKey(chatType, userId, chatId)) || new Map();
  const now = Date.now();
  const userIds = [];
  current.forEach((expiresAt, typingUserId) => {
    if (expiresAt <= now) current.delete(typingUserId);
    else if (typingUserId !== String(userId)) userIds.push(typingUserId);
  });
  res.json({ userIds });
});

app.post('/api/contacts', (req, res) => {
  const { userId, contactId } = req.body || {};
  if (!userId || !contactId) {
    return res.status(400).json({ error: 'userId and contactId are required.' });
  }

  const db = readDb();
  const user = db.users.find((entry) => entry.id === String(userId));
  const contact = db.users.find((entry) => entry.id === String(contactId));

  if (!user || !contact) {
    return res.status(404).json({ error: 'User not found.' });
  }

  user.contacts = Array.from(new Set([...(user.contacts || []), String(contactId)]));
  contact.contacts = Array.from(new Set([...(contact.contacts || []), String(userId)]));
  writeDb(db);

  res.json({ user: safeUser(user) });
});

app.post('/api/assistant', async (req, res) => {
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'Prompt is required.' });

  if (!GEMINI_API_KEY) {
    return res.json({
      reply: 'أنا TETO. أقدر أساعدك في صياغة الرسائل، تلخيص الكلام، وتنظيم يومك. أضف GEMINI_API_KEY لتفعيل إجابات Gemini الكاملة.',
      provider: 'local-fallback',
    });
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'أنت TETO، مساعد عربي دقيق وودود داخل تطبيق محادثات. أجب بالعربية إلا إذا طلب المستخدم غير ذلك. لا تخترع معلومات أو مصادر. افصل بين الحقائق والاستنتاجات، واذكر باختصار عندما تكون المعلومة غير مؤكدة أو تحتاج تحققًا. في الحسابات أو البرمجة تحقق من خطواتك قبل الإجابة. اجعل الرد واضحًا ومباشرًا، ولا تدّعي ضمان الصحة المطلقة.' }] },
        generationConfig: { temperature: 0.2, topP: 0.8, maxOutputTokens: 1200 },
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || 'Gemini request failed');
    const reply = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
    if (!reply) throw new Error('Empty Gemini response');
    res.json({ reply, provider: 'gemini' });
  } catch (error) {
    res.status(502).json({ error: 'تعذر الاتصال بمساعد Gemini الآن.' });
  }
});

app.put('/api/profile', (req, res) => {
  const { userId, name, status } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }

  const db = readDb();
  const user = db.users.find((entry) => entry.id === String(userId));
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  if (name) user.name = String(name).trim();
  if (status) user.status = String(status).trim();

  writeDb(db);
  res.json({ user: safeUser(user) });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TETO app running on http://0.0.0.0:${PORT}`);
});
