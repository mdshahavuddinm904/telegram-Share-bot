const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");
const config = require("./config");

const bot = new Telegraf(config.BOT_TOKEN);
const DB_FILE = "./db.json";

/* ================= DB ================= */
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, pending: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE));
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

/* ================= JOIN CHECK ================= */
async function checkJoin(ctx) {
  try {
    const res = await bot.telegram.getChatMember("@Global_Method_Channel", ctx.from.id);
    return ["creator", "administrator", "member"].includes(res.status);
  } catch {
    return false;
  }
}

/* ================= JOIN MSG ================= */
function joinMsg(ctx) {
  return ctx.reply(
    "❌ You must join channel first!",
    Markup.inlineKeyboard([
      [Markup.button.url("🌍 Join Channel", "https://t.me/Global_Method_Channel")],
      [Markup.button.callback("✅ I Joined", "check_join")]
    ])
  );
}

/* ================= STATE ================= */
const withdrawState = {};

/* ================= START ================= */
bot.start(async (ctx) => {
  const db = loadDB();
  const id = ctx.from.id;
  const ref = ctx.startPayload;

  if (!db.users[id]) {
    db.users[id] = {
      balance: 0,
      referrals: 0,
      joined: false,
      referredBy: ref || null,
      rewarded: false,
      lastBonus: 0,
      lastRequest: null
    };
  }

  const joined = await checkJoin(ctx);

  if (!joined) {
    saveDB(db);
    return joinMsg(ctx);
  }

  db.users[id].joined = true;
  saveDB(db);

  return ctx.reply("🎉 Welcome!");
});

/* ================= JOIN BUTTON ================= */
bot.action("check_join", async (ctx) => {
  const db = loadDB();
  const id = ctx.from.id;

  const joined = await checkJoin(ctx);
  if (!joined) return joinMsg(ctx);

  db.users[id].joined = true;

  const ref = db.users[id].referredBy;

  if (ref && db.users[ref] && !db.users[id].rewarded) {
    db.users[ref].balance += 0.30;
    db.users[ref].referrals += 1;

    bot.telegram.sendMessage(ref, "🎉 You earned $0.30 from referral!");
    db.users[id].rewarded = true;
  }

  saveDB(db);
  return ctx.reply("✅ Joined successfully!");
});

/* ================= MIDDLEWARE ================= */
async function mustJoin(ctx, next) {
  const joined = await checkJoin(ctx);
  if (!joined) return joinMsg(ctx);
  return next();
}

/* ================= REFER ================= */
bot.command("refer", mustJoin, (ctx) => {
  const link = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
  ctx.reply(`🔗 Your Link:\n${link}`);
});

/* ================= BALANCE ================= */
bot.command("balance", mustJoin, (ctx) => {
  const db = loadDB();
  const user = db.users[ctx.from.id];

  ctx.reply(`💰 Balance: $${user?.balance || 0}`);
});

/* ================= BONUS ================= */
bot.command("bonus", mustJoin, (ctx) => {
  const db = loadDB();
  const user = db.users[ctx.from.id];

  const now = Date.now();
  if (now - user.lastBonus < 86400000) {
    return ctx.reply("⏳ Wait 24h");
  }

  user.balance += 0.30;
  user.lastBonus = now;

  saveDB(db);
  ctx.reply("🎁 Bonus added!");
});

/* ================= WITHDRAW ================= */
bot.command("withdraw", mustJoin, (ctx) => {
  ctx.reply(
    "💸 Select Method:",
    Markup.inlineKeyboard([
      [Markup.button.callback("📱 BKash", "wd_bkash")],
      [Markup.button.callback("📱 Nagad", "wd_nagad")]
    ])
  );
});

function askNumber(ctx, method) {
  withdrawState[ctx.from.id] = { step: "number", method };
  ctx.reply(`Enter your ${method} number:`);
}

bot.action("wd_bkash", (ctx) => askNumber(ctx, "BKash"));
bot.action("wd_nagad", (ctx) => askNumber(ctx, "Nagad"));

bot.on("text", async (ctx) => {
  const db = loadDB();
  const id = ctx.from.id;

  if (withdrawState[id]) {
    const state = withdrawState[id];
    const user = db.users[id];

    if (state.step === "number") {
      state.number = ctx.message.text;
      state.step = "amount";
      return ctx.reply("💰 Enter amount:");
    }

    if (state.step === "amount") {
      const amount = Number(ctx.message.text);

      if (!user || user.balance < amount || amount < 5) {
        delete withdrawState[id];
        return ctx.reply("❌ Invalid amount");
      }

      const requestId = Date.now();

      user.balance -= amount;

      if (!db.pending) db.pending = [];
      db.pending.push({
        requestId,
        userId: id,
        amount,
        method: state.method,
        number: state.number
      });

      saveDB(db);

      delete withdrawState[id];
      return ctx.reply("✅ Request sent!");
    }
  }
});

/* ================= ADMIN PENDING ================= */
bot.command("pending", (ctx) => {
  if (ctx.from.id !== config.ADMIN_ID) return;

  const db = loadDB();
  const total = db.pending?.length || 0;

  ctx.reply(
    `📊 Pending: ${total}`,
    Markup.inlineKeyboard([
      [Markup.button.callback("📂 View Pending", "view_pending")]
    ])
  );
});

bot.action("view_pending", async (ctx) => {
  const db = loadDB();

  if (!db.pending || db.pending.length === 0) {
    return ctx.reply("✅ No pending");
  }

  for (const req of db.pending) {
    await ctx.reply(
      `💸 ID: ${req.requestId}\nUser: ${req.userId}\nAmount: $${req.amount}`,
      Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Approve", `approve_${req.requestId}_${req.userId}_${req.amount}`),
          Markup.button.callback("❌ Reject", `reject_${req.requestId}_${req.userId}_${req.amount}`)
        ]
      ])
    );
  }
});

/* ================= APPROVE ================= */
bot.action(/approve_(.+)_(.+)_(.+)/, async (ctx) => {
  if (ctx.from.id !== config.ADMIN_ID) return;

  const requestId = ctx.match[1];
  const userId = ctx.match[2];
  const amount = Number(ctx.match[3]);

  const db = loadDB();

  db.pending = db.pending.filter(r => r.requestId != requestId);
  saveDB(db);

  ctx.reply(`✅ Approved: $${amount}`);
  bot.telegram.sendMessage(userId, "✅ Payment sent!");
});

/* ================= REJECT ================= */
bot.action(/reject_(.+)_(.+)_(.+)/, async (ctx) => {
  if (ctx.from.id !== config.ADMIN_ID) return;

  const requestId = ctx.match[1];
  const userId = ctx.match[2];
  const amount = Number(ctx.match[3]);

  const db = loadDB();
  const user = db.users[userId];

  user.balance += amount;

  db.pending = db.pending.filter(r => r.requestId != requestId);
  saveDB(db);

  ctx.reply(`❌ Rejected: $${amount}`);
  bot.telegram.sendMessage(userId, "❌ Withdraw rejected, amount returned");
});

/* ================= START ================= */
bot.launch();
console.log("🚀 Bot Running...");
