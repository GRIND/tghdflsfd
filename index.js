require('dotenv').config()
const Telegraf = require('telegraf')
const Router = require('telegraf/router')
const Extra = require('telegraf/extra')
const Markup = require('telegraf/markup')
const session = require('telegraf/session')
const mysql = require('mysql')

const YA_KASSA_PAYMENT_TOKEN = process.env.YA_KASSA_TOKEN

const bot = new Telegraf(process.env.TG_BOT_TOKEN)

const menu_step_1 = Markup.inlineKeyboard([
    Markup.callbackButton('🚀 Разместить заказ', 'make_order'),
    Markup.callbackButton('❓ Узнать, как это работает', 'howto')
], {columns: 1})

const menu_step_2 = Markup.inlineKeyboard([
    Markup.callbackButton('текст ', 'order_category:text'),
    Markup.callbackButton('дизайн', 'order_category:design'),
    Markup.callbackButton('разработка', 'order_category:dev'),
    Markup.callbackButton('работа с cms', 'order_category:cms'),
    Markup.callbackButton('SMM', 'order_category:smm')
], {columns: 1})

const routerCallback = new Router((ctx) => {
    if (!ctx.callbackQuery.data) {
        return
    }
    const parts = ctx.callbackQuery.data.split(':')
    ctx.session.stage = 'category_selected'
    ctx.session.category = parts[1]
    return {
        route: parts[0],
        state: {
            order_type: parts[1]
        }
    }
})

const db_pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

/*db_con.connect(function(err) {
    //if (err) throw err;
    //console.log("Connected!");
});*/

const orderChangeStatus = function(status, order_id){
    db_pool.getConnection(function(err, connection) {
        //console.log(order_id);
        let sql = 'UPDATE orders SET state=?, last_changed = NOW() WHERE id=?';
        connection.query(sql, [status, order_id], (error) => {
            //if (error) throw error;
        });
        sql = 'INSERT INTO order_states SET ?'
        const ins_data = {
            order_id,
            state: status
        }
        connection.query(sql, ins_data, (error) => {
            //if (error) throw error;
        });
        connection.release();
    })
}

const dbSchemaCreate = function(){
    db_pool.getConnection(function(err, connection) {
        let sql = 'SELECT 1 FROM tg_user LIMIT 1';
        connection.query(sql, (error) => {
            if (error){
                sql = `CREATE TABLE tg_user (
                    tg_user_id INT(11) NOT NULL,
                    first_name VARCHAR(255) NULL DEFAULT NULL,
                    username VARCHAR(255) NULL DEFAULT NULL,
                    PRIMARY KEY (tg_user_id)
            )
                COLLATE='utf8_general_ci'
                ENGINE=InnoDB`

                connection.query(sql, (error) => {
                    sql = `
                    CREATE TABLE orders (
                        id INT(11) NOT NULL AUTO_INCREMENT,
                        tg_user_id INT(11) NOT NULL,
                        category VARCHAR(50) NOT NULL,
                        description MEDIUMTEXT NOT NULL,
                        price INT(11) NOT NULL,
                        state VARCHAR(50) NOT NULL,
                        last_changed TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        PRIMARY KEY (id),
                        INDEX FK_orders_tg_user (tg_user_id),
                        CONSTRAINT FK_orders_tg_user FOREIGN KEY (tg_user_id) REFERENCES tg_user (tg_user_id) ON UPDATE NO ACTION ON DELETE NO ACTION
                    )
                    COLLATE='utf8_general_ci'
                    ENGINE=InnoDB
                    AUTO_INCREMENT=46`
                    connection.query(sql, (error) => {
                        sql = `
                            CREATE TABLE order_states (
                                order_id INT(11) NOT NULL,
                                state VARCHAR(50) NOT NULL COLLATE 'latin1_swedish_ci',
                                timest TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                                INDEX FK_order_states_orders (order_id),
                                CONSTRAINT FK_order_states_orders FOREIGN KEY (order_id) REFERENCES orders (id) ON UPDATE CASCADE ON DELETE CASCADE
                            )
                            COLLATE='utf8_general_ci'
                            ENGINE=InnoDB`;
                        connection.query(sql, () =>{
                            connection.release();
                        });
                    })
                })
            }
        })
    })
}

dbSchemaCreate();

const saveOrderToDB = function(tg_user, sess, callback){
    db_pool.getConnection(function(err, connection) {
        let sql = 'INSERT INTO tg_user SET ? ON DUPLICATE KEY UPDATE username=username AND first_name = first_name'
        let ins_data = {
            tg_user_id: tg_user.id,
            first_name: tg_user.first_name,
            username: tg_user.username,
        }
        connection.query(sql, ins_data, (error) => {
            //if (error) throw error;

            sql = 'INSERT INTO orders SET ?'
            ins_data = {
                tg_user_id: tg_user.id,
                category: sess.category,
                description: sess.description,
                price: sess.price,
                state: 'not_paid',
            };
            connection.query(sql, ins_data, (error, result) => {
                //if (error) throw error;
                const order_id = result.insertId;
                ins_data = {
                    order_id,
                    state: 'not_paid'
                }
                sql = 'INSERT INTO order_states SET ?'
                connection.query(sql, ins_data, (error) => {
                    //if (error) throw error;
                    //console.log('Test:' + order_id);
                    connection.release();
                    return callback(order_id);
                });
            });
        });
    })
}

const products = {
    "text" : {
        name: 'Текст',
    },
    "design" : {
        name: 'Дизайн',
    },
    "dev" : {
        name: 'Разработка',
    },
    "cms" : {
        name: 'Работа с CMS',
    },
    "smm" : {
        name: 'SMM',
    },
}

function createInvoice(product, description, price) {
    return {
        provider_token: YA_KASSA_PAYMENT_TOKEN,
        start_parameter: 'foo', // что, бля, это?!
        title: product.name,
        description: description,
        currency: 'RUB',
        is_flexible: false,
        need_shipping_address: false,
        prices: [{ label: product.name, amount: Math.round(price * 100) }],
        payload: {}
    }
}

routerCallback.on('order_category', (ctx) => {
    ctx.reply("Принято! Опишите своими словами, что вам нужно:\nНапример: \"хочу дизайн визитки. Вот фото макета: ссылка\" ")
})

routerCallback.otherwise((ctx) => ctx.reply('🎆'))

bot.use(session({ ttl: 300 }))

bot.start((ctx) => {
    ctx.session.stage = '';
    ctx.reply("Добрый день!\n Я бот EasyBot! Что будем делать?", Extra.markup(menu_step_1))
})
bot.action('make_order', (ctx) => ctx.reply("Отлично! Выберите тематику:", Extra.markup(menu_step_2)))
bot.action('howto', (ctx) => ctx.reply("Отвечайте на вопросы бота"))

bot.on('callback_query', routerCallback)

bot.on('text', (ctx, next) => {
    if (!ctx.session.stage || ctx.session.stage === ''){
        ctx.reply("Введите /start и следуйте подсказкам bot'a")
        return next()
    }
    switch (ctx.session.stage){
    case 'category_selected': {
        ctx.session.stage = 'description_added';
        ctx.session.description = ctx.message.text;
        ctx.reply("Бюджет? Мы рекомендуем указать в диапозоне 500-3000 рублей");
        break;
    }
    case 'description_added': {
        const text = ctx.message.text.replace(' ', '');
        const price_num_matches = text.match(/\d+/);
        if (price_num_matches === null || price_num_matches[0] < 500) {
            ctx.reply("Введите бюджет заказа в виде числа. Сумма должна быть не менее 500 рублей.");
        }
        else {
            ctx.session.stage = 'order_entered';
            ctx.session.price = price_num_matches[0];
            saveOrderToDB(ctx.from, ctx.session, res => {
                ctx.session.order_id = res
            });

            //console.log(`${ctx.from.first_name} is about to buy a ${products[ctx.session.category].name}.`);
            ctx.replyWithInvoice(createInvoice(products[ctx.session.category], ctx.session.description, ctx.session.price))
        }
        break;
    }
    default:
        ctx.reply("Введите /start и следуйте подсказкам bot'a")
    }
    return next()
});

// Handle payment callbacks
bot.on('pre_checkout_query', ({ answerPreCheckoutQuery }) => answerPreCheckoutQuery(true))

bot.on('successful_payment', (ctx) => {
    orderChangeStatus('paid_not_complete',  ctx.session.order_id);
    ctx.reply("Отлично! Вы оплатили заказ. В ближайшее время мы предоставим кандидатов.");
    //console.log(`${ctx.from.first_name} (${ctx.from.username}) just payed ${ctx.message.successful_payment.total_amount / 100} руб.`)
    ctx.telegram.sendMessage(-1001263143654, `Новый заказ: ${ctx.session.description}. Бюджет: ${ctx.session.price}`);
})

bot.startPolling()