const { Telegraf, Markup } = require("telegraf");
const { initializeApp } = require("firebase/app");
const { getDatabase, ref, set, get, child } = require("firebase/database");
const fs = require("fs");
const path = require("path");

// Конфигурация: локально из config.js, на сервере из переменных окружения
let FIREBASE_CONFIG, token, ADMIN_ID;
try {
  const config = require("./config");
  FIREBASE_CONFIG = config.FIREBASE_CONFIG;
  token = config.token;
  ADMIN_ID = config.ADMIN_ID;
} catch (e) {
  FIREBASE_CONFIG = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.FIREBASE_DATABASE_URL,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
  };
  token = process.env.BOT_TOKEN;
  ADMIN_ID = Number(process.env.ADMIN_ID);
}

// Инициализация Firebase
const firebaseApp = initializeApp(FIREBASE_CONFIG);
const firebaseDB = getDatabase(firebaseApp);

// Инициализация бота
const bot = new Telegraf(token);

// Оплата производится переводом на карту (см. раздел СИСТЕМА ОПЛАТЫ ПЕРЕВОДОМ НА КАРТУ)

// ССЫЛКА НА ВАШ MINI APP (Вставьте сюда ссылку из GitHub Pages)
const WEB_APP_URL = "https://demonnikko.github.io/botos/";

// --- База данных приложений ---
// Загружаем каталог приложений из JSON-файла
const apps = JSON.parse(
  fs.readFileSync(path.join(__dirname, "products.json"), "utf-8"),
);

// --- Функция генерации ключа ---
function generateLicenseKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let key = "";
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      key += chars[Math.floor(Math.random() * chars.length)];
    }
    if (i < 2) key += "-";
  }
  let sum = 0;
  const data = key.replace(/-/g, "");
  for (let i = 0; i < data.length; i++) {
    sum += data.charCodeAt(i);
  }
  const check = (sum % 10000).toString(36).toUpperCase().padStart(4, "0");
  key += "-" + check;
  return key;
}

const getMainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("👤 Мой профиль", "profile")],
    [Markup.button.callback("❓ Частые вопросы", "faq")],
    [Markup.button.callback("🆘 Поддержка", "support")],
  ]);

// Reply-клавиатура с кнопкой Mini App (sendData работает только с reply keyboard)
const getShopKeyboard = () => ({
  reply_markup: {
    keyboard: [[{ text: "✨ Открыть магазин", web_app: { url: WEB_APP_URL } }]],
    resize_keyboard: true,
    is_persistent: true,
  }
});

// URL приветственной гифки
const WELCOME_GIF_URL = "https://demonnikko.github.io/botos/welcome.gif";

// --- Обработчики команд ---
bot.start(async (ctx) => {
  // Регистрируем пользователя в базе если его там нет
  const userId = ctx.from.id;
  try {
    const userRef = ref(firebaseDB, `users/${userId}/info`);
    const snapshot = await get(userRef);
    if (!snapshot.exists()) {
      await set(userRef, {
        id: userId,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name || '',
        username: ctx.from.username || '',
        registeredAt: new Date().toISOString()
      });
    }
  } catch (e) {
    console.error('Error registering user:', e);
  }

  // Приветственная гифка + reply-клавиатура с кнопкой магазина (внизу экрана)
  try {
    await ctx.replyWithAnimation(WELCOME_GIF_URL, {
      caption: "🎩 *Добро пожаловать в Illusionist OS!*\n\nВаша персональная операционная система для управления магическим бизнесом.\n\nЭто не просто приложение — это проверенная на практике *экосистема*, созданная специально для фокусников и артистов.\n\nЗдесь всё для вашей продуктивности и безупречного профессионализма: от ведения клиентов и контрактов до анализа доходов.\n\n✨ *Готовы вывести своё искусство на системный уровень?*",
      parse_mode: "Markdown",
      ...getShopKeyboard()
    });
  } catch (e) {
    // Если гифка не загрузилась — отправляем текст
    await ctx.reply(
      "🎩 *Добро пожаловать в Illusionist OS!*\n\nВаша персональная операционная система для управления магическим бизнесом.\n\nЭто не просто приложение — это проверенная на практике *экосистема*, созданная специально для фокусников и артистов.\n\n✨ *Готовы вывести своё искусство на системный уровень?*",
      { parse_mode: "Markdown", ...getShopKeyboard() },
    );
  }

  // Inline-навигация (профиль, FAQ, поддержка)
  await ctx.reply("Выберите раздел:", { ...getMainMenu() });
});

// ============================================
// СИСТЕМА УВЕДОМЛЕНИЙ ОБ ОШИБКАХ
// ============================================
// Специальная команда для получения ошибок из приложений
// Формат: /app_error <JSON с данными ошибки>
bot.command("app_error", async (ctx) => {
  try {
    // Проверяем что это не простой пользователь пытается отправить ошибку вручную
    const text = ctx.message.text;
    if (!text.includes("{") || !text.includes("}")) {
      return; // Игнорируем если это не JSON
    }

    // Парсим JSON из сообщения
    const jsonMatch = text.match(/\{.*\}/s);
    if (!jsonMatch) return;

    const errorData = JSON.parse(jsonMatch[0]);

    // Определяем из какого приложения пришла ошибка
    const appName = errorData.app === 'calendar' ? 'КАЛЕНДАРЕ' : 'КАЛЬКУЛЯТОРЕ';
    const appIcon = errorData.app === 'calendar' ? '📅' : '🧮';

    // Формируем красивое сообщение для админа
    let message = `🚨 <b>ОШИБКА В ${appName}</b> ${appIcon}\n\n`;

    if (errorData.type === "js_error") {
      message += `<b>Тип:</b> JavaScript Error\n`;
      message += `<b>Ошибка:</b> ${errorData.message || "Неизвестная ошибка"}\n`;
      if (errorData.file) message += `<b>Файл:</b> ${errorData.file}\n`;
      if (errorData.line) message += `<b>Строка:</b> ${errorData.line}\n`;
    } else if (errorData.type === "promise_error") {
      message += `<b>Тип:</b> Promise Rejection\n`;
      message += `<b>Причина:</b> ${errorData.reason || "Неизвестно"}\n`;
    }

    if (errorData.userAgent) {
      message += `<b>Устройство:</b> ${errorData.userAgent.substring(0, 100)}...\n`;
    }

    if (errorData.url) {
      message += `<b>URL:</b> ${errorData.url}\n`;
    }

    if (errorData.timestamp) {
      const date = new Date(errorData.timestamp);
      message += `<b>Время:</b> ${date.toLocaleString("ru-RU")}\n`;
    }

    // Отправляем уведомление ТОЛЬКО админу
    if (ADMIN_ID && ADMIN_ID !== 0) {
      await ctx.telegram.sendMessage(ADMIN_ID, message, { parse_mode: "HTML" });
      console.log("✅ Error notification sent to admin:", errorData.message);
    } else {
      console.warn("⚠️ ADMIN_ID не установлен в config.js! Ошибка не отправлена.");
    }

  } catch (error) {
    console.error("Ошибка при обработке app_error:", error);
  }
});

// Команда для логирования событий (активация, создание КП и т.д.)
bot.command("app_event", async (ctx) => {
  try {
    const text = ctx.message.text;
    if (!text.includes("{") || !text.includes("}")) {
      return;
    }

    const jsonMatch = text.match(/\{.*\}/s);
    if (!jsonMatch) return;

    const eventData = JSON.parse(jsonMatch[0]);

    // Определяем из какого приложения пришло событие
    const appName = eventData.app === 'calendar' ? 'КАЛЕНДАРЕ' : 'КАЛЬКУЛЯТОРЕ';
    const appIcon = eventData.app === 'calendar' ? '📅' : '🧮';

    let message = `📊 <b>СОБЫТИЕ В ${appName}</b> ${appIcon}\n\n`;
    message += `<b>Событие:</b> ${eventData.event || "Неизвестно"}\n`;

    if (eventData.data) {
      message += `<b>Данные:</b>\n`;
      Object.entries(eventData.data).forEach(([key, value]) => {
        message += `  • ${key}: ${value}\n`;
      });
    }

    if (eventData.timestamp) {
      const date = new Date(eventData.timestamp);
      message += `<b>Время:</b> ${date.toLocaleString("ru-RU")}\n`;
    }

    // Отправляем ТОЛЬКО админу
    if (ADMIN_ID && ADMIN_ID !== 0) {
      await ctx.telegram.sendMessage(ADMIN_ID, message, { parse_mode: "HTML" });
      console.log("✅ Event notification sent to admin:", eventData.event);
    }

  } catch (error) {
    console.error("Ошибка при обработке app_event:", error);
  }
});

// ============================================
// АДМИН ПАНЕЛЬ
// ============================================

// Проверка что это админ
function isAdmin(ctx) {
  return ctx.from.id === ADMIN_ID && ADMIN_ID !== 0;
}

// Состояние для multi-step диалогов админки
const adminState = {};

// Middleware для проверки админа
bot.use(async (ctx, next) => {
  // Если команда начинается с admin_ или /admin
  if (ctx.message?.text?.startsWith('/admin') ||
    ctx.callbackQuery?.data?.startsWith('admin_')) {
    if (!isAdmin(ctx)) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('❌ Доступ запрещен');
      } else {
        await ctx.reply('❌ Доступ запрещен. Эта функция только для администратора.');
      }
      return;
    }
  }
  return next();
});

// Команда /admin - главное меню
bot.command('admin', async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика', 'admin_stats')],
    [Markup.button.callback('🔑 Управление лицензиями', 'admin_licenses')],
    [Markup.button.callback('👥 Управление пользователями', 'admin_users')],
    [Markup.button.callback('📨 Рассылка сообщений', 'admin_broadcast')],
  ]);

  await ctx.reply(
    '🔐 *АДМИН ПАНЕЛЬ*\n\nВыберите раздел:',
    { ...keyboard, parse_mode: 'Markdown' }
  );
});

// Возврат в админ меню
bot.action('admin_menu', async (ctx) => {
  await ctx.answerCbQuery();

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Статистика', 'admin_stats')],
    [Markup.button.callback('🔑 Управление лицензиями', 'admin_licenses')],
    [Markup.button.callback('👥 Управление пользователями', 'admin_users')],
    [Markup.button.callback('📨 Рассылка сообщений', 'admin_broadcast')],
  ]);

  await ctx.editMessageText(
    '🔐 *АДМИН ПАНЕЛЬ*\n\nВыберите раздел:',
    { ...keyboard, parse_mode: 'Markdown' }
  );
});

// Обработчик данных от Web App
bot.on("web_app_data", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  try {
    const data = JSON.parse(ctx.message.web_app_data.data);
    if (data.action === "buy") {
      const app = apps.find((a) => a.id === data.id);
      if (app) {
        // Фильтруем скрытые планы
        const visiblePlans = app.plans.filter(plan => !plan.hidden);

        // Если только один план — сразу переходим к оплате
        if (visiblePlans.length === 1) {
          const plan = visiblePlans[0];
          const userId = ctx.from.id;

          // Сохраняем данные о покупке
          pendingPayments[userId] = {
            appId: app.id,
            planId: plan.id,
            appName: app.name,
            planLabel: plan.label,
            price: plan.price,
            duration: plan.duration,
            timestamp: new Date().toISOString()
          };

          // Формируем сообщение с реквизитами напрямую
          let message = `💳 *ОПЛАТА*\n\n`;
          message += `📱 Приложение: *${app.name}*\n`;
          message += `📋 Тариф: ${plan.label}\n`;
          message += `💰 К оплате: *${plan.price} ₽*\n\n`;
          message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
          message += `🏦 *Т-Банк (Тинькофф)*\n\n`;
          message += `💳 Номер карты:\n\`2200700820505963\`\n\n`;
          message += `📱 Или по номеру телефона:\n\`+7 909 276-33-86\`\n\n`;
          message += `👤 Получатель: Костюк Дмитрий Павлович\n\n`;
          message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
          message += `📸 *После перевода отправьте скриншот чека* прямо сюда.\n\n`;
          message += `💬 В комментарии к переводу ничего писать не нужно.\n\n`;
          message += `⏰ Время работы: 09:00 — 00:00 (МСК)\n`;
          message += `_Если оплата после полуночи — ключ придёт утром._\n\n`;
          message += `👆 _Нажмите на номер, чтобы скопировать_`;

          await ctx.reply(message, {
            parse_mode: "Markdown",
            reply_markup: {
              inline_keyboard: [
                [Markup.button.callback("❌ Отменить", "menu")]
              ]
            }
          });
        } else {
          // Показываем выбор тарифа
          const buttons = visiblePlans.map(plan => [
            Markup.button.callback(
              `${plan.label} — ${plan.price} ₽`,
              `buy_${app.id}_${plan.id}`
            )
          ]);
          buttons.push([Markup.button.callback("🔙 Отмена", "menu")]);

          await ctx.reply(
            `💳 *${app.name}*\n\nВыберите тариф:`,
            {
              parse_mode: "Markdown",
              reply_markup: { inline_keyboard: buttons }
            }
          );
        }
      }
    }
  } catch (e) {
    console.error("Ошибка обработки данных Web App", e);
    ctx.reply(`❌ Ошибка: ${e.message}`);
  }
});

// --- Обработчики кнопок ---
bot.action("menu", (ctx) => {
  ctx.editMessageText(
    "🎩 *Добро пожаловать в Illusionist OS*\n\nЭто экосистема для артистов.\n\nВыберите раздел:",
    { ...getMainMenu(), parse_mode: "Markdown" },
  );
});

bot.action("catalog", (ctx) => {
  const keyboard = apps.map((app) => [
    Markup.button.callback(app.name, `view_${app.id}`),
  ]);
  keyboard.push([Markup.button.callback("🔙 Назад в меню", "menu")]);
  ctx.editMessageText(
    "📱 *Каталог Illusionist OS*\n\nВыберите инструмент для вашего выступления:",
    {
      reply_markup: { inline_keyboard: keyboard },
      parse_mode: "Markdown",
    },
  );
});

bot.action(/view_(.+)/, (ctx) => {
  const appId = ctx.match[1];
  const app = apps.find((a) => a.id === appId);
  if (app) {
    // Берём минимальную цену для отображения "от..."
    const minPrice = Math.min(...app.plans.map(p => p.price));

    const text = `*${app.name}*\n\n${app.description}\n\n💎 *Стоимость:* от ${minPrice} ₽`;
    ctx.editMessageText(text, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("💳 Купить подписку", `plans_${app.id}`)],
          [Markup.button.callback("🔙 К списку", "catalog")],
        ],
      },
    });
  }
});

// Выбор плана подписки
bot.action(/plans_(.+)/, (ctx) => {
  const appId = ctx.match[1];
  const app = apps.find((a) => a.id === appId);

  if (app) {
    const visiblePlans = app.plans.filter(plan => !plan.hidden);
    const buttons = visiblePlans.map(plan => [
      Markup.button.callback(`${plan.label} — ${plan.price} ₽`, `buy_${app.id}_${plan.id}`)
    ]);
    buttons.push([Markup.button.callback("🔙 Назад", `view_${app.id}`)]);

    ctx.editMessageText(`📋 *Выберите тариф для "${app.name}":*`, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  }
});

bot.action("profile", async (ctx) => {
  const userId = ctx.from.id;
  const dbRef = ref(getDatabase());

  try {
    await ctx.answerCbQuery("Загружаю ваш профиль...");
    await ctx.replyWithChatAction("typing");

    const snapshot = await get(child(dbRef, `users/${userId}/purchases`));

    let message = `👤 *Профиль иллюзиониста*\n\nИмя: ${ctx.from.first_name}\nID: \`${userId}\`\n\n---`;

    if (snapshot.exists()) {
      message += "\n\n*🛒 Ваши покупки:*\n";
      const purchases = snapshot.val();
      Object.values(purchases).forEach((purchase) => {
        message += `\n*${purchase.appName}* (${purchase.planLabel || 'Без тарифа'})\n🔑 Ключ: \`${purchase.key}\`\n*Дата:* ${new Date(purchase.purchaseDate).toLocaleDateString(
          "ru-RU",
        )}\n`;
      });
    } else {
      message += "\n\nВы еще ничего не приобрели. Время это исправить! 😉";
    }

    await ctx.editMessageText(message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Назад в меню", "menu")]],
      },
    });
  } catch (error) {
    console.error("Firebase profile read error:", error);
    await ctx.editMessageText("❌ Не удалось загрузить ваш профиль. Попробуйте позже.", {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Назад в меню", "menu")]],
      },
    });
  }
});

bot.action("support", (ctx) => {
  ctx.editMessageText(
    "🆘 *Поддержка*\n\nЕсли у вас возникли вопросы по установке или использованию приложений, напишите мне:\n\n👤 @demonnikko\n\nОтвечу в течение 24 часов!",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[Markup.button.callback("🔙 Назад", "menu")]],
      },
    },
  );
});

// ============================================
// FAQ - ЧАСТЫЕ ВОПРОСЫ
// ============================================
const FAQ_DATA = [
  {
    id: "install",
    q: "📱 Как установить приложение?",
    a: "Наши приложения — это PWA (Progressive Web App). После покупки вы получите инструкцию:\n\n*iPhone:* Откройте ссылку в Safari → Поделиться → На экран «Домой»\n\n*Android:* Откройте в Chrome → Меню → Добавить на главный экран"
  },
  {
    id: "activate",
    q: "🔑 Как активировать лицензию?",
    a: "После покупки вы получите ключ вида `XXXX-XXXX-XXXX-XXXX`.\n\nОткройте приложение, введите ключ в окне активации и нажмите «Активировать».\n\nКлюч привязывается к вашему устройству."
  },
  {
    id: "devices",
    q: "📲 Сколько устройств?",
    a: "Одна лицензия = одно устройство.\n\nЕсли вы сменили телефон — напишите в поддержку, поможем перенести лицензию."
  },
  {
    id: "offline",
    q: "📴 Работает ли офлайн?",
    a: "Да! Все наши приложения работают без интернета.\n\nДанные хранятся локально на вашем устройстве и никуда не передаются."
  },
  {
    id: "renew",
    q: "🔄 Как продлить лицензию?",
    a: "За 7 дней до истечения вы получите напоминание.\n\nПросто купите новый тариф — он автоматически продлит вашу лицензию с текущей даты."
  },
  {
    id: "refund",
    q: "💸 Возврат средств",
    a: "Если приложение не подошло — напишите в поддержку в течение 3 дней после покупки.\n\nРассмотрим каждый случай индивидуально."
  }
];

bot.action("faq", (ctx) => {
  const buttons = FAQ_DATA.map(item => [
    Markup.button.callback(item.q, `faq_${item.id}`)
  ]);
  buttons.push([Markup.button.callback("🔙 Назад в меню", "menu")]);

  ctx.editMessageText(
    "❓ *Частые вопросы*\n\nВыберите интересующий вопрос:",
    {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: buttons },
    }
  );
});

// Обработчик конкретного вопроса
bot.action(/faq_(.+)/, (ctx) => {
  const faqId = ctx.match[1];
  const item = FAQ_DATA.find(f => f.id === faqId);

  if (item) {
    ctx.editMessageText(
      `${item.q}\n\n${item.a}`,
      {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback("🔙 К списку вопросов", "faq")],
            [Markup.button.callback("🆘 Написать в поддержку", "support")]
          ]
        },
      }
    );
  }
});

// ============================================
// СИСТЕМА ОПЛАТЫ ПЕРЕВОДОМ НА КАРТУ
// ============================================

// Реквизиты для оплаты
const PAYMENT_CARD = "2200 7008 2050 5963"; // Номер карты (с пробелами для читаемости)
const PAYMENT_CARD_RAW = "2200700820505963"; // Номер карты для копирования
const PAYMENT_PHONE = "+7 909 276-33-86"; // Телефон для СБП
const PAYMENT_CARD_HOLDER = "Костюк Дмитрий Павлович"; // Имя получателя
const PAYMENT_BANK = "Т-Банк (Тинькофф)"; // Банк

// Рабочие часы
const WORKING_HOURS = {
  start: 9,  // 09:00
  end: 24    // 00:00 (полночь)
};

// Хранилище ожидающих оплат
const pendingPayments = {};

bot.action(/buy_(.+?)_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  const appId = ctx.match[1];
  const planId = ctx.match[2];

  const app = apps.find((a) => a.id === appId);
  const plan = app ? app.plans.find(p => p.id === planId) : null;

  if (app && plan) {
    const userId = ctx.from.id;

    // Сохраняем данные о планируемой покупке
    pendingPayments[userId] = {
      appId,
      planId,
      appName: app.name,
      planLabel: plan.label,
      price: plan.price,
      duration: plan.duration,
      timestamp: new Date().toISOString()
    };

    // Формируем красивое сообщение с реквизитами
    let message = `💳 *ОПЛАТА*\n\n`;
    message += `📱 Приложение: *${app.name}*\n`;
    message += `📋 Тариф: ${plan.label}\n`;
    message += `💰 К оплате: *${plan.price} ₽*\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `🏦 *${PAYMENT_BANK}*\n\n`;
    message += `💳 Номер карты:\n\`${PAYMENT_CARD_RAW}\`\n\n`;
    message += `📱 Или по номеру телефона:\n\`${PAYMENT_PHONE}\`\n\n`;
    message += `👤 Получатель: ${PAYMENT_CARD_HOLDER}\n\n`;
    message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `📸 *После перевода отправьте скриншот чека* прямо сюда.\n\n`;
    message += `💬 В комментарии к переводу ничего писать не нужно.\n\n`;
    message += `⏰ Время работы: 09:00 — 00:00 (МСК)\n`;
    message += `_Если оплата после полуночи — ключ придёт утром._\n\n`;
    message += `👆 _Нажмите на номер, чтобы скопировать_`

    await ctx.editMessageText(message, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback("❌ Отменить", "menu")]
        ]
      }
    });
  }
});

// Обработка фото (скриншот чека)
bot.on("photo", async (ctx) => {
  const userId = ctx.from.id;
  const pending = pendingPayments[userId];

  // Если нет ожидающей оплаты — игнорируем
  if (!pending) return;

  // Получаем фото максимального размера
  const photo = ctx.message.photo[ctx.message.photo.length - 1];

  // Сохраняем данные чека
  pending.receiptPhotoId = photo.file_id;
  pending.receiptSentAt = new Date().toISOString();

  // Сохраняем в Firebase для истории
  try {
    await set(
      ref(firebaseDB, `pending_payments/${userId}`),
      pending
    );
  } catch (e) {
    console.error('Error saving pending payment:', e);
  }

  // Определяем текущий час
  const currentHour = new Date().getHours();
  const isWorkingHours = currentHour >= WORKING_HOURS.start && currentHour < WORKING_HOURS.end;

  // Отправляем подтверждение пользователю
  let userMessage = `✅ *Чек получен!*\n\n`;
  userMessage += `Ваша заявка на оплату:\n`;
  userMessage += `📱 ${pending.appName} (${pending.planLabel})\n`;
  userMessage += `💰 ${pending.price} ₽\n\n`;

  if (isWorkingHours) {
    userMessage += `⏳ Проверяем оплату... Обычно это занимает 5-15 минут.`;
  } else {
    userMessage += `🌙 Сейчас нерабочее время.\nВаш ключ будет отправлен после 09:00 (МСК).`;
  }

  await ctx.reply(userMessage, { parse_mode: "Markdown" });

  // Отправляем уведомление админу
  if (ADMIN_ID && ADMIN_ID !== 0) {
    let adminMessage = `💰 *НОВАЯ ОПЛАТА!*\n\n`;
    adminMessage += `👤 Пользователь: ${ctx.from.first_name}`;
    if (ctx.from.username) adminMessage += ` (@${ctx.from.username})`;
    adminMessage += `\n`;
    adminMessage += `🆔 ID: \`${userId}\`\n\n`;
    adminMessage += `📱 *${pending.appName}*\n`;
    adminMessage += `📋 Тариф: ${pending.planLabel}\n`;
    adminMessage += `💵 Сумма: ${pending.price} ₽\n`;
    adminMessage += `⏰ Время: ${new Date().toLocaleString('ru-RU')}\n`;

    // Отправляем фото чека админу
    await ctx.telegram.sendPhoto(ADMIN_ID, photo.file_id, {
      caption: adminMessage,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            Markup.button.callback("✅ Подтвердить", `confirm_payment_${userId}`),
            Markup.button.callback("❌ Отклонить", `reject_payment_${userId}`)
          ]
        ]
      }
    });
  }
});

// Подтверждение оплаты (только админ)
bot.action(/confirm_payment_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("❌ Доступ запрещен");

  const userId = parseInt(ctx.match[1]);
  const pending = pendingPayments[userId];

  if (!pending) {
    return ctx.answerCbQuery("⚠️ Заявка не найдена или уже обработана");
  }

  await ctx.answerCbQuery("Генерирую ключ...");

  // Генерируем ключ
  const newKey = generateLicenseKey();
  const now = new Date().toISOString();

  // Находим приложение
  const app = apps.find(a => a.id === pending.appId);

  // Сохраняем лицензию в Firebase
  const licenseData = {
    key: newKey,
    appName: pending.appName,
    buyer: {
      id: userId,
      firstName: '',
      lastName: '',
      username: ''
    },
    payment: pending.price,
    currency: 'RUB',
    expiryDays: pending.duration,
    created: now,
    activated: false,
    deviceId: null,
    installId: null,
    activatedDate: null,
    lastCheck: null,
    planLabel: pending.planLabel,
    paymentMethod: 'card_transfer'
  };

  try {
    await set(
      ref(firebaseDB, `licenses/${newKey.replace(/[.#$[\]]/g, "-")}`),
      licenseData
    );

    // Отправляем ключ пользователю
    let successMessage = `🎉 *Оплата подтверждена!*\n\n`;
    successMessage += `Спасибо за покупку *${pending.appName}*!\n\n`;
    successMessage += `🔑 Ваш ключ активации:\n\`${newKey}\`\n\n`;
    successMessage += `_(Нажмите на ключ, чтобы скопировать)_\n\n`;
    successMessage += `📋 Тариф: ${pending.planLabel}\n`;
    successMessage += `⏰ Срок действия: ${pending.duration} дней\n\n`;
    successMessage += `Приятного использования! ✨`;

    const keyboard = [];
    if (app && app.videoUrl) {
      keyboard.push([Markup.button.url("🎓 Смотреть обучение", app.videoUrl)]);
    }
    if (app && app.appUrl) {
      keyboard.push([Markup.button.url("🚀 Открыть приложение", app.appUrl)]);
    }

    await ctx.telegram.sendMessage(userId, successMessage, {
      parse_mode: "Markdown",
      reply_markup: keyboard.length ? { inline_keyboard: keyboard } : undefined
    });

    // Обновляем сообщение админа
    await ctx.editMessageCaption(
      ctx.callbackQuery.message.caption + `\n\n✅ *ПОДТВЕРЖДЕНО*\n🔑 \`${newKey}\``,
      { parse_mode: "Markdown" }
    );

    // Удаляем из pending и Firebase
    delete pendingPayments[userId];
    await set(ref(firebaseDB, `pending_payments/${userId}`), null);

  } catch (error) {
    console.error('Error confirming payment:', error);
    await ctx.reply("❌ Ошибка при создании ключа. Попробуйте вручную через админку.");
  }
});

// Отклонение оплаты (только админ)
bot.action(/reject_payment_(\d+)/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery("❌ Доступ запрещен");

  const userId = parseInt(ctx.match[1]);
  const pending = pendingPayments[userId];

  if (!pending) {
    return ctx.answerCbQuery("⚠️ Заявка не найдена");
  }

  await ctx.answerCbQuery("Отклонено");

  // Уведомляем пользователя
  await ctx.telegram.sendMessage(userId,
    `❌ *Оплата не подтверждена*\n\nК сожалению, мы не смогли подтвердить вашу оплату.\n\nВозможные причины:\n• Сумма перевода не совпадает\n• Чек нечитаемый\n• Перевод не поступил\n\nПожалуйста, свяжитесь с поддержкой для уточнения.`,
    { parse_mode: "Markdown" }
  );

  // Обновляем сообщение админа
  await ctx.editMessageCaption(
    ctx.callbackQuery.message.caption + `\n\n❌ *ОТКЛОНЕНО*`,
    { parse_mode: "Markdown" }
  );

  delete pendingPayments[userId];
  await set(ref(firebaseDB, `pending_payments/${userId}`), null);
});



// --- Обработка платежей ---
bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));

bot.on("successful_payment", async (ctx) => {
  await ctx.replyWithChatAction("typing");
  const payment = ctx.message.successful_payment;

  // Парсим payload: "appId_planId"
  const [appId, planId] = payment.invoice_payload.split('_');
  const userId = ctx.from.id;

  const app = apps.find((a) => a.id === appId);
  const plan = app ? app.plans.find(p => p.id === planId) : null;

  if (app && plan) {
    const newKey = generateLicenseKey();
    const purchaseDate = new Date().toISOString();

    // Данные для общей таблицы лицензий
    const licenseData = {
      key: newKey,
      appName: app.name,
      buyer: {
        id: userId,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name || "",
        username: ctx.from.username || "",
      },
      payment: payment.total_amount / 100,
      currency: payment.currency,
      expiryDays: plan.duration, // Берем срок из плана
      created: purchaseDate,
      activated: false,
      deviceId: null,
      installId: null,
      activatedDate: null,
      lastCheck: null,
      planLabel: plan.label // Сохраняем название тарифа
    };

    // Данные для профиля пользователя
    const userPurchaseData = {
      appName: app.name,
      appId: app.id,
      key: newKey,
      purchaseDate: purchaseDate,
      price: payment.total_amount / 100,
      currency: payment.currency,
      expiryDays: plan.duration,
      planLabel: plan.label
    };

    try {
      // Сохраняем данные в обе таблицы параллельно
      await Promise.all([
        set(ref(firebaseDB, "licenses/" + newKey.replace(/[.#$[]]/g, "-")), licenseData),
        set(ref(firebaseDB, `users/${userId}/purchases/${newKey.replace(/[.#$[]]/g, "-")}`), userPurchaseData) // Сохраняем по ключу, чтобы можно было иметь несколько лицензий одного продукта
      ]);

      let successMessage = `✅ *Оплата прошла успешно!*\n\n`;
      successMessage += `Тариф: *${plan.label}*\n`;
      successMessage += `Спасибо за покупку *${app.name}*.\n\n`;
      successMessage += `🔑 Ваш ключ активации:\n\`${newKey}\`\n\n`;
      successMessage += `(Нажмите на ключ, чтобы скопировать)\n\n`;
      successMessage += `⬇️ *Что делать дальше?*`;

      const keyboard = [];

      // Ссылка на видео-обучение
      if (app.videoUrl) {
        keyboard.push([Markup.button.url("🎓 Смотреть обучение", app.videoUrl)]);
      }

      // Ссылка на Web App (если нужно сразу открыть)
      if (app.appUrl) {
        keyboard.push([Markup.button.url("🚀 Открыть приложение", app.appUrl)]);
      } else {
        keyboard.push([Markup.button.webApp("🚀 Открыть приложение", WEB_APP_URL)]);
      }

      await ctx.replyWithMarkdown(successMessage, Markup.inlineKeyboard(keyboard));

      // Отправляем текстовую инструкцию, если есть
      if (app.training) {
        await ctx.replyWithMarkdown("📋 *Инструкция:*\n\n" + app.training);
      }

    } catch (error) {
      console.error("Firebase save error:", error);
      ctx.reply("⚠️ Оплата прошла, но возникла ошибка при генерации ключа. Пожалуйста, напишите в поддержку (@admin_username), мы выдадим ключ вручную.");
    }
  }
});

// ============================================
// АДМИН ПАНЕЛЬ - ОБРАБОТЧИКИ
// (Этот файл будет встроен в index.js перед bot.launch())
// ============================================

// 📊 СТАТИСТИКА
bot.action('admin_stats', async (ctx) => {
  await ctx.answerCbQuery('Загружаю статистику...');
  await ctx.editMessageText('⏳ Загрузка статистики...', { parse_mode: 'Markdown' });

  const dbRef = ref(getDatabase());

  try {
    // Получаем все данные
    const [usersSnapshot, licensesSnapshot] = await Promise.all([
      get(child(dbRef, 'users')),
      get(child(dbRef, 'licenses'))
    ]);

    // Подсчитываем статистику
    const users = usersSnapshot.val() || {};
    const licenses = licensesSnapshot.val() || {};

    const totalUsers = Object.keys(users).length;
    const totalLicenses = Object.keys(licenses).length;

    let activeLicenses = 0;
    let todaySales = 0;
    let monthSales = 0;
    let totalRevenue = 0;
    const appStats = {};

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    Object.values(licenses).forEach(license => {
      if (license.activated) activeLicenses++;

      const created = new Date(license.created);
      if (created >= todayStart) todaySales++;
      if (created >= monthStart) monthSales++;

      totalRevenue += license.payment || 0;

      // Статистика по приложениям
      const appName = license.appName || 'Неизвестно';
      appStats[appName] = (appStats[appName] || 0) + 1;
    });

    // Сортируем приложения по популярности
    const topApps = Object.entries(appStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => `  • ${name}: ${count} продаж`)
      .join('\n');

    const message = `
📊 *СТАТИСТИКА*

👥 *Пользователи:* ${totalUsers}
🔑 *Лицензии:* ${totalLicenses}
✅ *Активных:* ${activeLicenses}

💰 *Продажи:*
  • За сегодня: ${todaySales}
  • За месяц: ${monthSales}
  • Общая выручка: ${totalRevenue.toLocaleString('ru-RU')} ₽

📱 *Топ приложений:*
${topApps || '  Пока нет продаж'}
    `.trim();

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🔄 Обновить', 'admin_stats')],
      [Markup.button.callback('🔙 Назад в меню', 'admin_menu')]
    ]);

    await ctx.editMessageText(message, { ...keyboard, parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Admin stats error:', error);
    await ctx.editMessageText('❌ Ошибка при загрузке статистики', {
      reply_markup: { inline_keyboard: [[Markup.button.callback('🔙 Назад', 'admin_menu')]] }
    });
  }
});

// 🔑 УПРАВЛЕНИЕ ЛИЦЕНЗИЯМИ
bot.action('admin_licenses', async (ctx) => {
  await ctx.answerCbQuery();

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📋 Список лицензий', 'admin_licenses_list_0')],
    [Markup.button.callback('➕ Создать ключ вручную', 'admin_licenses_create')],
    [Markup.button.callback('🔙 Назад', 'admin_menu')]
  ]);

  await ctx.editMessageText(
    '🔑 *УПРАВЛЕНИЕ ЛИЦЕНЗИЯМИ*\n\nВыберите действие:',
    { ...keyboard, parse_mode: 'Markdown' }
  );
});

// Список лицензий (с пагинацией)
bot.action(/admin_licenses_list_(\d+)/, async (ctx) => {
  const page = parseInt(ctx.match[1]);
  const PAGE_SIZE = 10;

  await ctx.answerCbQuery('Загружаю лицензии...');

  try {
    const dbRef = ref(getDatabase());
    const snapshot = await get(child(dbRef, 'licenses'));
    const licenses = snapshot.val() || {};

    const licenseArray = Object.entries(licenses)
      .sort((a, b) => new Date(b[1].created) - new Date(a[1].created));

    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageData = licenseArray.slice(start, end);

    let message = '🔑 *СПИСОК ЛИЦЕНЗИЙ*\n\n';

    if (pageData.length === 0) {
      message += 'Пока нет лицензий';
    } else {
      pageData.forEach(([key, data], index) => {
        const num = start + index + 1;
        const status = data.activated ? '✅' : '❌';
        const buyer = data.buyer?.firstName || 'Unknown';
        message += `${num}. ${status} \`${key}\`\n`;
        message += `   👤 ${buyer} | 📱 ${data.appName}\n\n`;
      });
    }

    const buttons = [];

    // Кнопки пагинации
    const navButtons = [];
    if (page > 0) {
      navButtons.push(Markup.button.callback('⬅️ Назад', `admin_licenses_list_${page - 1}`));
    }
    if (end < licenseArray.length) {
      navButtons.push(Markup.button.callback('➡️ Далее', `admin_licenses_list_${page + 1}`));
    }
    if (navButtons.length) buttons.push(navButtons);

    buttons.push([Markup.button.callback('🔙 К меню лицензий', 'admin_licenses')]);

    const keyboard = Markup.inlineKeyboard(buttons);

    await ctx.editMessageText(message, { ...keyboard, parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error listing licenses:', error);
    await ctx.editMessageText('❌ Ошибка при загрузке лицензий');
  }
});

// Создать ключ вручную - выбор приложения
bot.action('admin_licenses_create', async (ctx) => {
  await ctx.answerCbQuery();

  // Показываем список приложений
  const buttons = apps.map(app => [
    Markup.button.callback(app.name, `admin_license_create_app_${app.id}`)
  ]);
  buttons.push([Markup.button.callback('🔙 Отмена', 'admin_licenses')]);

  const keyboard = Markup.inlineKeyboard(buttons);

  await ctx.editMessageText(
    '➕ *СОЗДАТЬ КЛЮЧ ВРУЧНУЮ*\n\nВыберите приложение:',
    { ...keyboard, parse_mode: 'Markdown' }
  );
});

// Выбор приложения
bot.action(/admin_license_create_app_(.+)/, async (ctx) => {
  const appId = ctx.match[1];
  const app = apps.find(a => a.id === appId);

  if (!app) return;

  await ctx.answerCbQuery();

  // Сохраняем выбор
  adminState[ctx.from.id] = { step: 'app_selected', appId, app };

  // Показываем тарифы
  const buttons = app.plans.map(plan => [
    Markup.button.callback(
      `${plan.label} — ${plan.price} ₽`,
      `admin_license_create_plan_${plan.id}`
    )
  ]);
  buttons.push([Markup.button.callback('🔙 Назад', 'admin_licenses_create')]);

  const keyboard = Markup.inlineKeyboard(buttons);

  await ctx.editMessageText(
    `➕ *СОЗДАТЬ КЛЮЧ ДЛЯ ${app.name}*\n\nВыберите тариф:`,
    { ...keyboard, parse_mode: 'Markdown' }
  );
});

// Выбор тарифа
bot.action(/admin_license_create_plan_(.+)/, async (ctx) => {
  const planId = ctx.match[1];
  const state = adminState[ctx.from.id];

  if (!state || state.step !== 'app_selected') {
    await ctx.answerCbQuery('Ошибка. Начните сначала.');
    return;
  }

  const plan = state.app.plans.find(p => p.id === planId);
  if (!plan) return;

  await ctx.answerCbQuery();

  // Сохраняем выбор
  state.step = 'plan_selected';
  state.planId = planId;
  state.plan = plan;

  await ctx.editMessageText(
    `➕ *СОЗДАТЬ КЛЮЧ*\n\n` +
    `📱 Приложение: ${state.app.name}\n` +
    `📋 Тариф: ${plan.label}\n\n` +
    `Отправьте Telegram ID пользователя (число)\nили нажмите "Без пользователя" чтобы создать ключ без привязки:`,
    {
      reply_markup: {
        inline_keyboard: [
          [Markup.button.callback('🔓 Без пользователя', 'admin_license_create_no_user')],
          [Markup.button.callback('🔙 Отмена', 'admin_licenses')]
        ]
      },
      parse_mode: 'Markdown'
    }
  );

  state.step = 'waiting_user_id';
});

// Создать без пользователя
bot.action('admin_license_create_no_user', async (ctx) => {
  const state = adminState[ctx.from.id];

  if (!state || state.step !== 'waiting_user_id') return;

  await ctx.answerCbQuery();

  // Создаем ключ без пользователя
  await createManualLicense(ctx, state, null);
  delete adminState[ctx.from.id];
});

// Функция создания ключа вручную
async function createManualLicense(ctx, state, userId) {
  const newKey = generateLicenseKey();
  const now = new Date().toISOString();

  const licenseData = {
    key: newKey,
    appName: state.app.name,
    buyer: userId ? {
      id: userId,
      firstName: 'Manual',
      lastName: '',
      username: ''
    } : null,
    payment: 0, // Выдано вручную
    currency: 'RUB',
    expiryDays: state.plan.duration,
    created: now,
    activated: false,
    deviceId: null,
    installId: null,
    activatedDate: null,
    lastCheck: null,
    planLabel: state.plan.label,
    createdBy: 'admin',
    adminNote: 'Выдано вручную'
  };

  try {
    await set(
      ref(firebaseDB, "licenses/" + newKey.replace(/[.#$[\]]/g, "-")),
      licenseData
    );

    let message = `✅ *КЛЮЧ СОЗДАН*\n\n🔑 \`${newKey}\`\n\n`;
    message += `📱 Приложение: ${state.app.name}\n`;
    message += `📋 Тариф: ${state.plan.label}\n`;
    message += `⏰ Срок: ${state.plan.duration} дней\n`;

    if (userId) {
      message += `\n👤 Пользователь: ${userId}\n`;
      message += `\nОтправить ключ пользователю?`;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📤 Отправить', `admin_send_key_${userId}_${newKey}`)],
        [Markup.button.callback('✅ Готово', 'admin_licenses')]
      ]);

      await ctx.reply(message, { ...keyboard, parse_mode: 'Markdown' });
    } else {
      await ctx.reply(message + '\n\n(Ключ создан без привязки к пользователю)', {
        reply_markup: {
          inline_keyboard: [
            [Markup.button.callback('✅ Готово', 'admin_licenses')]
          ]
        },
        parse_mode: 'Markdown'
      });
    }
  } catch (error) {
    console.error('Error creating manual license:', error);
    await ctx.reply('❌ Ошибка при создании ключа. Попробуйте еще раз.');
  }
}

// Отправка ключа пользователю
bot.action(/admin_send_key_(\d+)_(.+)/, async (ctx) => {
  const userId = ctx.match[1];
  const key = ctx.match[2];

  await ctx.answerCbQuery('Отправляю...');

  try {
    await ctx.telegram.sendMessage(
      userId,
      `🎁 Вам выдан лицензионный ключ:\n\n🔑 \`${key}\`\n\n` +
      `Используйте его для активации приложения.`,
      { parse_mode: 'Markdown' }
    );

    await ctx.reply('✅ Ключ отправлен пользователю!', {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback('✅ Готово', 'admin_licenses')]]
      }
    });
  } catch (error) {
    await ctx.reply('❌ Не удалось отправить. Возможно пользователь не запускал бота.');
  }
});

// 👥 УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
bot.action('admin_users', async (ctx) => {
  await ctx.answerCbQuery();

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📋 Список пользователей', 'admin_users_list_0')],
    [Markup.button.callback('🔍 Найти по ID', 'admin_users_search')],
    [Markup.button.callback('🔙 Назад', 'admin_menu')]
  ]);

  await ctx.editMessageText(
    '👥 *УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ*\n\nВыберите действие:',
    { ...keyboard, parse_mode: 'Markdown' }
  );
});

// Список пользователей
bot.action(/admin_users_list_(\d+)/, async (ctx) => {
  const page = parseInt(ctx.match[1]);
  const PAGE_SIZE = 10;

  await ctx.answerCbQuery('Загружаю пользователей...');

  try {
    const dbRef = ref(getDatabase());
    const snapshot = await get(child(dbRef, 'users'));
    const users = snapshot.val() || {};

    const userArray = Object.entries(users);
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    const pageData = userArray.slice(start, end);

    let message = '👥 *СПИСОК ПОЛЬЗОВАТЕЛЕЙ*\n\n';

    if (pageData.length === 0) {
      message += 'Пока нет пользователей';
    } else {
      pageData.forEach(([userId, userData], index) => {
        const num = start + index + 1;
        const purchases = userData.purchases ? Object.keys(userData.purchases).length : 0;
        message += `${num}. ID: \`${userId}\`\n`;
        message += `   🛒 Покупок: ${purchases}\n\n`;
      });
    }

    const buttons = [];
    const navButtons = [];
    if (page > 0) {
      navButtons.push(Markup.button.callback('⬅️', `admin_users_list_${page - 1}`));
    }
    if (end < userArray.length) {
      navButtons.push(Markup.button.callback('➡️', `admin_users_list_${page + 1}`));
    }
    if (navButtons.length) buttons.push(navButtons);

    buttons.push([Markup.button.callback('🔙 Назад', 'admin_users')]);

    const keyboard = Markup.inlineKeyboard(buttons);

    await ctx.editMessageText(message, { ...keyboard, parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Error listing users:', error);
    await ctx.editMessageText('❌ Ошибка при загрузке пользователей');
  }
});

// Поиск пользователя
bot.action('admin_users_search', async (ctx) => {
  await ctx.answerCbQuery();

  adminState[ctx.from.id] = { step: 'searching_user' };

  await ctx.editMessageText(
    '🔍 *ПОИСК ПОЛЬЗОВАТЕЛЯ*\n\nОтправьте Telegram ID пользователя:',
    {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback('🔙 Отмена', 'admin_users')]]
      },
      parse_mode: 'Markdown'
    }
  );
});

// 📨 РАССЫЛКА
bot.action('admin_broadcast', async (ctx) => {
  await ctx.answerCbQuery();

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📢 Отправить всем', 'admin_broadcast_all')],
    [Markup.button.callback('📤 Отправить одному', 'admin_broadcast_one')],
    [Markup.button.callback('🔙 Назад', 'admin_menu')]
  ]);

  await ctx.editMessageText(
    '📨 *РАССЫЛКА СООБЩЕНИЙ*\n\nВыберите действие:',
    { ...keyboard, parse_mode: 'Markdown' }
  );
});

// Рассылка всем
bot.action('admin_broadcast_all', async (ctx) => {
  await ctx.answerCbQuery();

  adminState[ctx.from.id] = { step: 'broadcast_all' };

  await ctx.editMessageText(
    '📢 *РАССЫЛКА ВСЕМ*\n\n' +
    'Отправьте сообщение которое хотите разослать:\n\n' +
    '(Поддерживается Markdown форматирование)',
    {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback('🔙 Отмена', 'admin_broadcast')]]
      },
      parse_mode: 'Markdown'
    }
  );
});

// Рассылка одному
bot.action('admin_broadcast_one', async (ctx) => {
  await ctx.answerCbQuery();

  adminState[ctx.from.id] = { step: 'broadcast_one_id' };

  await ctx.editMessageText(
    '📤 *ОТПРАВИТЬ ОДНОМУ*\n\nОтправьте Telegram ID пользователя:',
    {
      reply_markup: {
        inline_keyboard: [[Markup.button.callback('🔙 Отмена', 'admin_broadcast')]]
      },
      parse_mode: 'Markdown'
    }
  );
});

// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ДЛЯ АДМИНКИ
bot.on('text', async (ctx) => {
  const state = adminState[ctx.from.id];

  // Создание ключа с User ID
  if (state && state.step === 'waiting_user_id') {
    const userId = parseInt(ctx.message.text);

    if (isNaN(userId)) {
      await ctx.reply('❌ Неверный формат. Отправьте число (Telegram ID).');
      return;
    }

    await createManualLicense(ctx, state, userId);
    delete adminState[ctx.from.id];
    return;
  }

  // Поиск пользователя
  if (state && state.step === 'searching_user') {
    const userId = ctx.message.text.trim();

    try {
      const dbRef = ref(getDatabase());
      const snapshot = await get(child(dbRef, `users/${userId}`));

      if (!snapshot.exists()) {
        await ctx.reply('❌ Пользователь не найден.');
        delete adminState[ctx.from.id];
        return;
      }

      const userData = snapshot.val();
      const purchases = userData.purchases || {};

      let message = `👤 *ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ*\n\nID: \`${userId}\`\n🛒 Покупок: ${Object.keys(purchases).length}\n\n`;

      if (Object.keys(purchases).length > 0) {
        message += `*Лицензии:*\n`;
        Object.values(purchases).forEach(purchase => {
          message += `\n• ${purchase.appName}\n`;
          message += `  🔑 \`${purchase.key}\`\n`;
          message += `  💰 ${purchase.price} ${purchase.currency}\n`;
          message += `  📅 ${new Date(purchase.purchaseDate).toLocaleDateString('ru-RU')}\n`;
        });
      }

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('📤 Отправить сообщение', `admin_msg_user_${userId}`)],
        [Markup.button.callback('🔙 Назад', 'admin_users')]
      ]);

      await ctx.reply(message, { ...keyboard, parse_mode: 'Markdown' });
      delete adminState[ctx.from.id];
    } catch (error) {
      console.error('Error searching user:', error);
      await ctx.reply('❌ Ошибка при поиске');
    }
    return;
  }

  // Рассылка всем
  if (state && state.step === 'broadcast_all') {
    const message = ctx.message.text;

    await ctx.reply('📨 Начинаю рассылку...');

    const dbRef = ref(getDatabase());
    const snapshot = await get(child(dbRef, 'users'));
    const users = snapshot.val() || {};

    let sent = 0;
    let failed = 0;

    for (const userId of Object.keys(users)) {
      try {
        await ctx.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
        sent++;
      } catch (error) {
        failed++;
      }

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    await ctx.reply(
      `✅ Рассылка завершена!\n\n📤 Отправлено: ${sent}\n❌ Не доставлено: ${failed}`,
      {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback('✅ Готово', 'admin_broadcast')]]
        }
      }
    );

    delete adminState[ctx.from.id];
    return;
  }

  // Рассылка одному - ввод ID
  if (state && state.step === 'broadcast_one_id') {
    const userId = ctx.message.text.trim();

    adminState[ctx.from.id] = { step: 'broadcast_one_message', userId };

    await ctx.reply(
      `📤 Отправить пользователю \`${userId}\`\n\nОтправьте сообщение:`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Рассылка одному - ввод сообщения
  if (state && state.step === 'broadcast_one_message') {
    const message = ctx.message.text;
    const userId = state.userId;

    try {
      await ctx.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });

      await ctx.reply('✅ Сообщение отправлено!', {
        reply_markup: {
          inline_keyboard: [[Markup.button.callback('✅ Готово', 'admin_broadcast')]]
        }
      });
    } catch (error) {
      await ctx.reply('❌ Не удалось отправить. Пользователь не запускал бота.');
    }

    delete adminState[ctx.from.id];
    return;
  }
});

// Кнопка отправки сообщения пользователю из профиля
bot.action(/admin_msg_user_(\d+)/, async (ctx) => {
  const userId = ctx.match[1];

  await ctx.answerCbQuery();

  adminState[ctx.from.id] = { step: 'broadcast_one_message', userId };

  await ctx.reply(
    `📤 Отправить пользователю \`${userId}\`\n\nОтправьте сообщение:`,
    { parse_mode: 'Markdown' }
  );
});

// ============================================
// СИСТЕМА УВЕДОМЛЕНИЙ ОБ ИСТЕЧЕНИИ ЛИЦЕНЗИЙ
// ============================================
async function checkExpiringLicenses() {
  console.log('🔍 Проверка истекающих лицензий...');

  const dbRef = ref(getDatabase());

  try {
    const snapshot = await get(child(dbRef, 'licenses'));
    const licenses = snapshot.val() || {};

    const now = new Date();
    const notifyDays = [7, 3, 1]; // За сколько дней уведомлять

    for (const [key, license] of Object.entries(licenses)) {
      // Пропускаем неактивированные лицензии
      if (!license.activated || !license.activatedDate) continue;

      // Вычисляем дату истечения
      const activatedDate = new Date(license.activatedDate);
      const expiryDate = new Date(activatedDate);
      expiryDate.setDate(expiryDate.getDate() + (license.expiryDays || 365));

      // Сколько дней осталось
      const daysLeft = Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24));

      // Проверяем нужно ли отправить уведомление
      if (notifyDays.includes(daysLeft) && license.buyer?.id) {
        // Проверяем что мы ещё не отправляли уведомление за этот день
        const notifyKey = `notified_${daysLeft}d`;
        if (license[notifyKey]) continue;

        const userId = license.buyer.id;

        let message = '';
        let emoji = '';

        if (daysLeft === 7) {
          emoji = '📅';
          message = `${emoji} Напоминание!\n\nВаша лицензия на *${license.appName}* истекает через 7 дней.\n\nПродлите подписку заранее, чтобы не потерять доступ к приложению.`;
        } else if (daysLeft === 3) {
          emoji = '⚠️';
          message = `${emoji} Внимание!\n\nВаша лицензия на *${license.appName}* истекает через 3 дня.\n\nНе забудьте продлить подписку!`;
        } else if (daysLeft === 1) {
          emoji = '🚨';
          message = `${emoji} Срочно!\n\nВаша лицензия на *${license.appName}* истекает *ЗАВТРА*!\n\nПродлите сейчас, чтобы продолжить пользоваться приложением.`;
        }

        try {
          await bot.telegram.sendMessage(userId, message, {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [Markup.button.webApp('🔄 Продлить подписку', WEB_APP_URL)]
              ]
            }
          });

          // Отмечаем что уведомление отправлено
          await set(
            ref(firebaseDB, `licenses/${key.replace(/[.#$[\]]/g, "-")}/${notifyKey}`),
            new Date().toISOString()
          );

          console.log(`✅ Уведомление отправлено: ${license.appName} -> ${userId} (${daysLeft} дней)`);
        } catch (e) {
          console.error(`❌ Ошибка отправки уведомления: ${e.message}`);
        }
      }
    }

    console.log('✅ Проверка лицензий завершена');
  } catch (error) {
    console.error('❌ Ошибка проверки лицензий:', error);
  }
}

// Запускаем проверку при старте бота
setTimeout(() => {
  checkExpiringLicenses();
}, 5000); // Через 5 секунд после запуска

// Повторяем каждые 24 часа
setInterval(() => {
  checkExpiringLicenses();
}, 24 * 60 * 60 * 1000); // 24 часа

// Ручной запуск проверки из админки
bot.command('check_licenses', async (ctx) => {
  if (!isAdmin(ctx)) return;
  await ctx.reply('🔍 Запускаю проверку лицензий...');
  await checkExpiringLicenses();
  await ctx.reply('✅ Проверка завершена!');
});

// Запуск бота
bot.launch();
console.log("Бот успешно запущен на Telegraf!");

// Обработка ошибок
bot.catch((err, ctx) => {
  console.log(`Ooops, encountered an error for ${ctx.updateType}`, err);
});

// Включаем graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));