import { Suspense } from "react";
import { MessengerButtons } from "@/components/messenger-buttons";

export default function Home() {
  return (
    <>
      <nav className="nav">
        <input type="checkbox" id="nav-toggle" />
        <div className="nav-in">
          <a href="#start" className="logo">
            О<b>·</b>пора
          </a>
          <div className="nav-links">
            <a href="#not-guilty">Вы не одни</a>
            <a href="#how">Как это работает</a>
            <a href="#path">Путь родителей</a>
            <a href="#experts">Специалисты</a>
            <a href="#faq">Вопросы</a>
          </div>
          <a href="#start-now" className="nav-cta">
            Оставить заявку
          </a>
          <label className="burger" htmlFor="nav-toggle" aria-label="Меню">
            <span></span>
          </label>
        </div>
        <nav className="drawer">
          <a href="#not-guilty">Вы не одни</a>
          <a href="#how">Как это работает</a>
          <a href="#path">Путь родителей</a>
          <a href="#refusing">Если ребёнок против</a>
          <a href="#experts">Специалисты</a>
          <a href="#faq">Вопросы</a>
          <a href="#start-now">Оставить заявку</a>
        </nav>
      </nav>

      {/* 1. HERO */}
      <header className="hero" id="start">
        <div className="hero-in">
          <div>
            <span className="eyebrow">Центр помощи при РПП · работаем с родителями</span>
            <h1>
              Ребёнок с анорексией отказывается от помощи? <em>Путь к его выздоровлению начинается с вас.</em>
            </h1>
            <p className="hero-lead">
              Когда подросток всё отрицает, уговоры бессильны — и это не ваша вина. Есть другой путь: через родителя.
            </p>
            <div className="hero-actions">
              <a href="#start-now" className="btn btn-primary">
                Оставить заявку
              </a>
              <a href="#how" className="btn btn-ghost">
                Как это работает
              </a>
            </div>
            <p className="hero-note">Онлайн по всей России · очно в Нижнем Новгороде · конфиденциально</p>
          </div>
          <div className="hero-visual">
            <div className="imgph hero-img">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              <div className="t">Фото: мама и подросток, тёплый момент</div>
              <div className="d">Промт 1 · спокойная близость у окна, без вида «болезни»</div>
              <div className="sz">1000 × 880 px</div>
            </div>
            <aside className="hero-card">
              <h3>Знакомо, если:</h3>
              <ul>
                <li>вы уговариваете и объясняете, а в ответ — стена</li>
                <li>ребёнок не считает себя больным и отказывается от помощи</li>
                <li>вы чувствуете вину и бессилие и не знаете, за что взяться</li>
              </ul>
            </aside>
          </div>
        </div>
      </header>

      {/* 2. NOT GUILTY */}
      <section className="sec sec-sand" id="not-guilty">
        <div className="wrap">
          <div className="sec-head">
            <span className="step-label">Вы не виноваты</span>
            <h2>Отказ ребёнка — это не ваша ошибка. Это часть болезни.</h2>
            <p>
              Сопротивление и отрицание — типичная черта расстройства пищевого поведения, а не признак того, что вы
              «недоглядели» или «плохо воспитали».
            </p>
          </div>
          <div className="cards-3">
            <div className="card">
              <div className="qt">«Я всё перепробовала»</div>
              <p>Разговоры, контроль, просьбы, слёзы — и ничего не меняется. Это тупик, в который попадают очень многие родители.</p>
            </div>
            <div className="card">
              <div className="qt">«Он не хочет лечиться»</div>
              <p>Ребёнок не признаёт проблему и отвергает любую помощь. Ждать, пока «сам захочет», — не единственный вариант.</p>
            </div>
            <div className="card">
              <div className="qt">«Наверное, это я виновата»</div>
              <p>Чувство вины изматывает и мешает действовать. Но причина болезни не в вас, и выход из тупика существует.</p>
            </div>
          </div>
          <div className="strip">
            <p>«Вы не обязаны справляться в одиночку и не обязаны сначала переубедить ребёнка. Помощь может начаться с вас».</p>
            <a href="#how" className="btn btn-primary">
              Показать, как это работает
            </a>
          </div>
        </div>
      </section>

      {/* 3. NOT ALONE */}
      <section className="sec sec-sand2" id="not-alone">
        <div className="wrap">
          <div className="sec-head">
            <span className="step-label">Вы не одна такая</span>
            <h2>За этой проблемой — сотни таких же мам. Вы не одни.</h2>
          </div>
          <div className="alone">
            <div>
              <p>
                Рядом — родители, которые прошли через то же самое: те же бессонные ночи, тот же страх, та же
                беспомощность. Здесь вы среди своих, а не наедине с бедой.
              </p>
            </div>
            <div className="imgph alone-img">
              <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="7" cy="9" r="2.5" />
                <circle cx="17" cy="9" r="2.5" />
                <circle cx="12" cy="14" r="2.5" />
              </svg>
              <div className="t">Графика: общность / «вы не одна»</div>
              <div className="d">Промт 2 · мягкие круги-«люди», акцент янтарём. Можно SVG</div>
              <div className="sz">1000 × 600 px</div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. HOW */}
      <section className="sec sec-sand" id="how">
        <div className="wrap">
          <div className="sec-head">
            <span className="step-label">Шаг 2 · как это работает</span>
            <h2>Почему помощь начинается с родителя, а не с ребёнка</h2>
            <p>Ребёнок сопротивляется давлению — но реагирует на то, как ведёт себя семья рядом. Мы работаем с этим.</p>
          </div>
          <div className="mech">
            <div className="mech-card">
              <div className="mech-ic">
                икон.
                <br />
                48×48
              </div>
              <h3>Меняется ваша опора</h3>
              <p>Вместо уговоров и контроля, которые усиливают сопротивление, — ясная стратегия поведения от специалиста.</p>
            </div>
            <div className="mech-card">
              <div className="mech-ic">
                икон.
                <br />
                48×48
              </div>
              <h3>Меняется обстановка дома</h3>
              <p>Спокойнее рядом — безопаснее ребёнку. Спадает напряжение вокруг еды и конфликтов.</p>
            </div>
            <div className="mech-card">
              <div className="mech-ic">
                икон.
                <br />
                48×48
              </div>
              <h3>Снижается сопротивление</h3>
              <p>Когда исчезает борьба, у ребёнка появляется место, чтобы принять помощь. Шаг становится возможным.</p>
            </div>
          </div>
          <p className="note-line">
            Это не волшебная таблетка и не обещание быстрого результата. Это работа, где вы становитесь тем, кто
            меняет ситуацию, пока ребёнок ещё не готов.
          </p>
          <div className="mech-cta">
            <a href="#start-now" className="btn btn-dark">
              Забрать гайд «3 фразы, которые усиливают сопротивление»
            </a>
          </div>
        </div>
      </section>

      {/* 5. NO MORE SEARCH */}
      <section className="sec sec-sand2" id="no-more-search">
        <div className="wrap">
          <div className="search-in">
            <div className="sec-head" style={{ marginBottom: 0 }}>
              <span className="step-label">Хватит метаться</span>
              <h2>Вы год ищете, куда бежать, и всё мимо?</h2>
              <p>
                Многие родители до нас обошли всё: психологов, психотерапевтов, врачей — и снова оставались в
                отчаянии. Здесь вам дадут не ещё одну попытку наугад, а точку опоры и понятное направление.
              </p>
              <div style={{ marginTop: 24 }}>
                <a href="#start-now" className="btn btn-primary">
                  Оставить заявку
                </a>
              </div>
            </div>
            <div>
              <div className="search-card">
                <span className="strike">Психолог — «приходите с ребёнком»</span>
                <span className="strike">Врач — очередь и направления</span>
                <span className="strike">Форумы — чужие советы наугад</span>
                <div className="arrow">→ Здесь начинают с вас и вашей ситуации</div>
              </div>
              <div className="imgph search-img">
                <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5L5 21" />
                </svg>
                <div className="t">Фото: обретённая опора (опционально)</div>
                <div className="d">Промт 3 · женщина у окна, спокойствие после тревоги</div>
                <div className="sz">960 × 720 px</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 6. PATH */}
      <section className="sec sec-deep" id="path">
        <div className="wrap">
          <div className="sec-head">
            <span className="eyebrow">Путь родителей</span>
            <h2>Из тупика — шаг за шагом</h2>
            <p>
              Так выглядит путь родителя, который начал с себя, когда ребёнок отказывался от любой помощи. Без чудес —
              через последовательные шаги.
            </p>
          </div>
          <div className="journey">
            <div className="j-card">
              <div className="j-phase">Точка А</div>
              <p>Полное бессилие: ребёнок отрицает проблему, любая помощь заканчивается конфликтом.</p>
            </div>
            <div className="j-card">
              <div className="j-phase">Первый шаг</div>
              <p>Родитель приходит на диагностику один — без ребёнка — и получает понимание, что делать дальше.</p>
            </div>
            <div className="j-card">
              <div className="j-phase">Работа</div>
              <p>Вместе со специалистом выстраивается новая стратегия поведения и общения в семье.</p>
            </div>
            <div className="j-card">
              <div className="j-phase">Сдвиг</div>
              <p>Напряжение вокруг еды спадает, диалог с ребёнком восстанавливается, появляется опора.</p>
            </div>
          </div>
          <p className="j-disc">
            Путь показывает этапы работы, а не гарантированный результат. Течение и исход в каждой семье
            индивидуальны и зависят от многих факторов.
          </p>
          <div className="journey-cta">
            <a href="#start-now" className="btn btn-primary">
              Оставить заявку на бесплатную диагностику
            </a>
          </div>
        </div>
      </section>

      {/* 7. REFUSING */}
      <section className="sec sec-sand" id="refusing">
        <div className="wrap">
          <span className="step-label" style={{ display: "block", marginBottom: 18 }}>
            Ядро нашей работы
          </span>
          <div className="refuse">
            <h2>Ребёнок не хочет лечиться? Вам не нужно его сначала переубеждать.</h2>
            <p>
              Ждать, пока ребёнок «сам захочет», — не единственный вариант. Вы можете действовать первой: создать
              условия, в которых он постепенно примет помощь. Именно с этого мы и начинаем.
            </p>
            <a href="#start-now" className="btn btn-primary">
              Разобрать вашу ситуацию
            </a>
          </div>
        </div>
      </section>

      {/* 8. EXPERTS */}
      <section className="sec sec-sand2" id="experts">
        <div className="wrap">
          <div className="sec-head">
            <span className="step-label">Кто будет рядом с вами</span>
            <h2>Специалисты, которые работают именно с родителями подростков с РПП</h2>
            <p>Узкая специализация на расстройствах пищевого поведения и на семейной работе — а не «обо всём понемногу».</p>
          </div>
          <div className="exp">
            <div className="exp-card">
              <div className="exp-photo">
                <div className="imgph">
                  <div className="t">Фото специалиста</div>
                  <div className="d">реальная съёмка</div>
                  <div className="sz">760 × 900 px</div>
                </div>
              </div>
              <div className="exp-body">
                <h3>Имя Фамилия</h3>
                <div className="exp-role">Клинический психолог, специалист по РПП</div>
                <p>
                  Опыт работы с расстройствами пищевого поведения у подростков. Помогает родителям выстроить
                  стратегию, когда ребёнок отказывается от помощи.
                </p>
              </div>
            </div>
            <div className="exp-card">
              <div className="exp-photo">
                <div className="imgph">
                  <div className="t">Фото специалиста</div>
                  <div className="d">реальная съёмка</div>
                  <div className="sz">760 × 900 px</div>
                </div>
              </div>
              <div className="exp-body">
                <h3>Имя Фамилия</h3>
                <div className="exp-role">Психотерапевт, семейная терапия</div>
                <p>Работа с семейной системой и коммуникацией вокруг болезни. Сопровождение родителя на всех этапах.</p>
              </div>
            </div>
            <div className="exp-card">
              <div className="exp-photo">
                <div className="imgph">
                  <div className="t">Фото специалиста</div>
                  <div className="d">реальная съёмка</div>
                  <div className="sz">760 × 900 px</div>
                </div>
              </div>
              <div className="exp-body">
                <h3>Имя Фамилия</h3>
                <div className="exp-role">Врач-психиатр</div>
                <p>Медицинская оценка состояния и сопровождение при необходимости. Работает в связке с психологами центра.</p>
              </div>
            </div>
          </div>
          <div className="chips">
            <div className="chip">
              <b>№ ЛО-…</b> медицинская лицензия
            </div>
            <div className="chip">
              <b>N</b> лет работы с РПП
            </div>
            <div className="chip">
              <b>N</b> семей получили помощь
            </div>
            <div className="chip">Онлайн по всей России</div>
          </div>
          <p className="exp-sub">Узкая специализация на расстройствах пищевого поведения — а не «обо всём понемногу».</p>
        </div>
      </section>

      {/* 9. FAQ */}
      <section className="sec sec-sand" id="faq">
        <div className="wrap">
          <div className="sec-head">
            <span className="step-label">Частые сомнения родителей</span>
            <h2>Отвечаем на то, что вас останавливает</h2>
          </div>
          <div className="faq">
            <details className="faq-item" open>
              <summary className="faq-q">Разве это не работа для ребёнка, а не для меня?</summary>
              <div className="faq-a">
                Помощь ребёнку остаётся целью. Но когда он отказывается, именно родитель может изменить ситуацию
                первым — создать условия, в которых ребёнок постепенно примет помощь.
              </div>
            </details>
            <details className="faq-item">
              <summary className="faq-q">Я же не пациент. Зачем работать со мной?</summary>
              <div className="faq-a">
                Вы не пациент — вы главный ресурс ребёнка. Работа с родителем даёт вам инструменты вместо бессилия и
                помогает выйти из изматывающей борьбы.
              </div>
            </details>
            <details className="faq-item">
              <summary className="faq-q">А если у нас всё слишком запущено?</summary>
              <div className="faq-a">
                Именно чтобы это оценить, и нужна первичная диагностика. Специалист разберёт вашу конкретную ситуацию
                и подскажет, с чего начать — без осуждения.
              </div>
            </details>
            <details className="faq-item">
              <summary className="faq-q">Это конфиденциально? И нужно ли согласие ребёнка?</summary>
              <div className="faq-a">
                Обращение конфиденциально. На первую диагностику родитель может прийти один — присутствие или
                согласие ребёнка для этого не требуется.
              </div>
            </details>
            <details className="faq-item">
              <summary className="faq-q">А это не «один курс — и всё решится»?</summary>
              <div className="faq-a">
                Нет. Мы честно говорим: это процесс, а не обещание мгновенного результата. Мы не даём гарантий
                излечения — мы системно помогаем родителю менять ситуацию.
              </div>
            </details>
            <details className="faq-item">
              <summary className="faq-q">Сколько это стоит?</summary>
              <div className="faq-a">
                Первичная диагностика — бесплатна и ни к чему не обязывает. Дальнейший формат и стоимость обсуждаются
                только после неё, по вашему решению.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* 10. PRICING */}
      <section className="sec sec-sand2" id="pricing">
        <div className="wrap">
          <div className="sec-head">
            <span className="step-label">С чего начать</span>
            <h2>Начать можно с малого — и бесплатно</h2>
          </div>
          <div className="ladder">
            <div className="rung rung-1">
              <div className="tier">Ступень 1</div>
              <h3>Бесплатная диагностика</h3>
              <p>Знакомство и разбор вашей ситуации. Без обязательств и осуждения.</p>
            </div>
            <div className="rung rung-2">
              <div className="tier">Ступень 2</div>
              <h3>Лёгкий формат</h3>
              <p>Клуб для родителей или разовая встреча по запросу — опора без большого шага.</p>
            </div>
            <div className="rung rung-3">
              <div className="tier">Ступень 3</div>
              <h3>Основная программа</h3>
              <p>Системная работа, когда вы готовы идти глубже.</p>
            </div>
          </div>
          <p className="ladder-sub">Вы сами выбираете, на какой ступени остановиться. Никто не подталкивает.</p>
        </div>
      </section>

      {/* 11. FINAL + BOT BUTTONS */}
      <section className="sec final" id="start-now">
        <div className="wrap">
          <div className="final-in">
            <div>
              <span className="eyebrow">Первый разговор ничего не стоит</span>
              <h2>Первый шаг — бесплатный. Дальше решаете вы.</h2>
              <p className="final-lead">
                Оставьте заявку в удобном мессенджере — бот задаст пару вопросов и передаст вашу ситуацию специалисту.
                Он свяжется с вами и предложит время бесплатной диагностики.
              </p>
              <ul className="checks">
                <li>Бесплатно и без обязательств</li>
                <li>Конфиденциально, без осуждения</li>
                <li>Можно онлайн, из любого города</li>
                <li>Родитель может обратиться один</li>
              </ul>
            </div>
            <div className="contact-card">
              <h3>Оставить заявку</h3>
              <p className="fsub">Выберите мессенджер — дальше всё подскажет бот.</p>
              <Suspense fallback={<div className="msg-btns" />}>
                <MessengerButtons code="footer" />
              </Suspense>
              <p className="contact-note">Бот уточнит имя и контакт, чтобы специалист мог связаться с вами.</p>
              <p className="form-note">
                Оставляя заявку, вы соглашаетесь с политикой обработки персональных данных. Имеются противопоказания,
                необходима консультация специалиста.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="foot">
        <div className="wrap">
          <div className="foot-in">
            <div>
              <a href="#start" className="logo">
                О<b>·</b>пора
              </a>
              <p>
                Центр психологической помощи при расстройствах пищевого поведения. Помогаем родителям подростков,
                столкнувшихся с анорексией и другими РПП. Онлайн по всей России, очный приём в Нижнем Новгороде.
              </p>
            </div>
            <div>
              <p>
                Телефон: +7 (___) ___-__-__
                <br />
                Почта: help@psi-opora.ru
                <br />
                Нижний Новгород, ул. ________, д. __
              </p>
            </div>
          </div>
          <div className="foot-legal">
            ООО «________», ИНН ________, ОГРН ________. Медицинская лицензия № ЛО-________ от __.__.____.
            <br />
            Имеются противопоказания, необходима консультация специалиста. Информация на сайте не является публичной
            офертой и не гарантирует результата оказания услуг. Материалы носят информационный характер.
          </div>
        </div>
      </footer>

      <div className="mcta">
        <a href="#start-now" className="btn btn-primary">
          Оставить заявку
        </a>
      </div>
    </>
  );
}
