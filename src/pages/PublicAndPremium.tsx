import { useRef, useState } from 'react'
import { Icon } from '../components/Icons'
import { Avatar, Button } from '../components/UI'
import { useStore } from '../store'
import type { PremiumRequest } from '../types'
import { appConfig } from '../config'
import { premiumRequestService } from '../services/premiumRequestService'
import { validateImage } from '../services/avatarService'

export function PublicLogo() {
  return <div className="logo public-logo"><span className="logo-mark"><i/><i/></span><b>LifeTime</b></div>
}

export function LandingPage({ openAuth }: { openAuth: (mode: 'signin' | 'signup') => void }) {
  return <div className="landing">
    <header className="landing-header"><PublicLogo/><nav><button onClick={() => document.getElementById('benefits')?.scrollIntoView({ behavior: 'smooth' })}>Можливості</button><button onClick={() => document.getElementById('privacy')?.scrollIntoView({ behavior: 'smooth' })}>Приватність</button></nav><div><Button variant="ghost" onClick={() => openAuth('signin')}>Увійти</Button><Button onClick={() => openAuth('signup')}>Зареєструватися</Button></div></header>
    <main>
      <section className="landing-hero">
        <div className="hero-copy"><span className="landing-kicker"><i/>Розклад, у якому є місце для життя</span><h1>Знаходь час для того, що <em>справді важливо.</em></h1><p>Плануй справи, організовуй зустрічі та знаходь спільний вільний час із друзями — легко й без нескінченних переписок.</p><div className="hero-actions"><Button onClick={() => openAuth('signup')}>Почати безкоштовно <Icon name="arrow" size={17}/></Button><Button variant="secondary" onClick={() => openAuth('signin')}>У мене вже є акаунт</Button></div><small><Icon name="check" size={14}/> Реєстрація займає менше хвилини</small></div>
        <button className="product-preview" onClick={() => openAuth('signup')} aria-label="Зареєструватися, щоб відкрити календар">
          <div className="preview-top"><span><PublicLogo/></span><span>Твій тиждень</span><i>ОШ</i></div>
          <div className="preview-body"><div className="preview-sidebar">{['Огляд','Календар','Завдання','Знайти час'].map((x,i)=><span className={i===1?'active':''} key={x}><Icon name={['overview','calendar','tasks','find'][i]} size={14}/>{x}</span>)}</div><div className="preview-calendar"><div className="preview-title"><div><small>14–20 жовтня</small><b>Спокійний тиждень</b></div><span>+ Подія</span></div><div className="preview-days">{['Пн 14','Вт 15','Ср 16','Чт 17','Пт 18'].map((d)=><b key={d}>{d}</b>)}</div><div className="preview-grid"><i className="pevent p1">Лекція</i><i className="pevent p2">Командний синк</i><i className="pevent p3">Тренування</i><i className="pevent p4">Кава із Софією</i></div></div></div>
          <div className="preview-float"><span><Icon name="spark" size={16}/></span><div><b>3 спільні вільні вікна</b><small>Найкраще — четвер о 14:00</small></div><Icon name="arrow" size={15}/></div>
        </button>
      </section>
      <section className="landing-trust"><span>Один простір для</span><b>навчання</b><i/> <b>роботи</b><i/> <b>друзів</b><i/> <b>власного часу</b></section>
      <section className="benefits-section" id="benefits"><div className="section-intro"><span className="eyebrow">Менше узгоджень. Більше життя.</span><h2>Планування, яке не виснажує</h2><p>LifeTime поєднує особистий календар, завдання та соціальну координацію в одній спокійній системі.</p></div><div className="benefit-grid">
        <article className="benefit-large"><span className="benefit-icon"><Icon name="find"/></span><h3>Спільний час без здогадок</h3><p>Обери людей і тривалість — LifeTime знайде реальні перетини вільних проміжків.</p><div className="availability-overlap"><i/><i/><i/><b>14:00</b></div></article>
        <article><span className="benefit-icon green"><Icon name="calendar"/></span><h3>Увесь день перед очима</h3><p>Події, дедлайни й особисті плани утворюють один зрозумілий ритм.</p></article>
        <article><span className="benefit-icon coral"><Icon name="tasks"/></span><h3>Завдання поруч із часом</h3><p>Пріоритети та дедлайни живуть поруч із календарем, а не в окремому списку без контексту.</p></article>
        <article><span className="benefit-icon"><Icon name="assistant"/></span><h3>Premium AI-помічник</h3><p>Допомагає аналізувати тиждень, вільні вікна та створювати плани за підтримуваними запитами.</p></article>
        <article id="privacy"><span className="benefit-icon coral"><Icon name="lock"/></span><h3>Приватність за замовчуванням</h3><p>Друзі бачать лише «вільно» або «зайнято», а не назви приватних подій.</p></article>
      </div></section>
      <section className="landing-cta"><span className="eyebrow">Твій час має значення</span><h2>Почни планувати життя,<br/>а не лише календар.</h2><Button onClick={() => openAuth('signup')}>Зареєструватися <Icon name="arrow" size={17}/></Button></section>
    </main>
    <footer className="landing-footer"><PublicLogo/><p>LifeTime допомагає робити час для того, що має значення.</p><span>Локальна версія · серверні інтеграції підключаються окремо</span></footer>
  </div>
}

export function PremiumPage() {
  const { currentUser, setCurrentUser, premiumRequests, setPremiumRequests } = useStore()
  const existing = [...premiumRequests].reverse().find((r) => r.userId === currentUser.id)
  const [form, setForm] = useState({ lastName: currentUser.lastName, firstName: currentUser.firstName })
  const [screenshot, setScreenshot] = useState<{ file: File; preview: string } | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const donationUrl = appConfig.donationJarUrl
  const selectScreenshot = (file?: File) => {
    if (!file) return
    const validation = validateImage(file)
    if (validation) return setError(validation)
    const reader = new FileReader()
    reader.onload = () => { setScreenshot({ file, preview: String(reader.result) }); setError('') }
    reader.onerror = () => setError('Не вдалося прочитати зображення.')
    reader.readAsDataURL(file)
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (currentUser.premiumStatus === 'pending') return
    if (!form.lastName.trim() || !form.firstName.trim() || !screenshot) return setError('Вкажи ім’я, прізвище та додай скриншот підтвердження.')
    setSubmitting(true); setError('')
    try {
      const request = await premiumRequestService.submit({ userId: currentUser.id, firstName: form.firstName.trim(), lastName: form.lastName.trim(), accountEmail: currentUser.email, screenshotDataUrl: screenshot.preview, screenshotFileName: screenshot.file.name })
      setPremiumRequests([...premiumRequests, request])
      setCurrentUser({ ...currentUser, firstName: form.firstName.trim(), lastName: form.lastName.trim(), premiumStatus: 'pending' })
      setSuccess('Заявку збережено локально. Надсилання на email буде доступне після підключення сервера.')
    } catch {
      setError('Не вдалося зберегти заявку. Спробуй ще раз.')
    } finally { setSubmitting(false) }
  }
  const status = currentUser.premiumStatus
  return <div className="page premium-page">
    <section className="premium-hero"><div><span className="premium-crown"><Icon name="crown"/></span><span className="eyebrow">LifeTime Premium</span><h1>Розумніше планування.<br/>Відчутна підтримка.</h1><p>AI-помічник доступний користувачам LifeTime Premium. Підтримай збір для ЗСУ та подай заявку на Premium-доступ.</p></div><div className="premium-feature-card"><span><Icon name="assistant"/></span><div><b>Контекстний AI-помічник</b><p>Аналізує локальний розклад, дедлайни та вільні вікна. У прототипі працює за детермінованими правилами.</p></div></div></section>
    <div className="premium-layout"><section className="premium-steps"><span className="eyebrow">Як це працює</span>{[['01','Підтримай перевірений збір','Пожертва відбувається на зовнішній платформі. LifeTime не приймає платежі.'],['02','Додай одне підтвердження','Нам потрібні лише ім’я, прізвище й один скриншот для ручного перегляду.'],['03','Дочекайся перевірки','Скриншот не активує Premium автоматично. Рішення приймає уповноважений адміністратор.']].map(([n,t,d])=><div className="premium-step" key={n}><b>{n}</b><span><h3>{t}</h3><p>{d}</p></span></div>)}<div className="safety-note"><Icon name="lock"/><p>Перед завантаженням приховай зайві персональні або банківські дані. Скриншот не повинен містити номер картки, CVV, пароль чи дані входу в банк.</p></div></section>
      <section className="premium-application">
        {status === 'premium' ? <StatusPanel icon="crown" title="Premium активовано" text="Тобі доступний AI-помічник і Розумне планування. Статус надано після перевірки заявки." tone="success"/> :
        status === 'pending' ? <StatusPanel icon="clock" title="Заявка на перевірці" text={`Подано ${existing ? new Date(existing.submittedAt).toLocaleDateString('uk-UA') : 'щойно'}. Поки адміністратор не звірить дані, Premium не активується.`} tone="pending"/> :
        <><div className="application-head"><div><span className="eyebrow">{status === 'rejected' ? 'Можна уточнити дані' : 'Заявка на доступ'}</span><h2>{status === 'rejected' ? 'Попередню заявку відхилено' : 'Після пожертви заповни форму'}</h2></div>{status === 'rejected' && <p className="reject-note">{existing?.reviewNotes || 'Не вдалося підтвердити транзакцію. Перевірте дані або додайте референс платежу.'}</p>}</div>
          <div className="donation-action"><Button disabled={!donationUrl} onClick={() => donationUrl && window.open(donationUrl, '_blank', 'noopener,noreferrer')}>Задонатити на ЗСУ <Icon name="arrow" size={16}/></Button>{donationUrl&&<small>Відкриється зовнішня перевірена платформа. Після пожертви повернися до форми.</small>}</div>
          <form className="premium-form" onSubmit={submit}><div className="form-grid"><label className="field"><span>Ім’я</span><input value={form.firstName} onChange={(e)=>setForm({...form,firstName:e.target.value})}/></label><label className="field"><span>Прізвище</span><input value={form.lastName} onChange={(e)=>setForm({...form,lastName:e.target.value})}/></label></div><div className="account-email"><Icon name="check" size={15}/><span><b>Email акаунта</b>{currentUser.email}</span></div>
            <div className={`screenshot-drop ${screenshot?'has-file':''}`} onDragOver={(e)=>e.preventDefault()} onDrop={(e)=>{e.preventDefault();selectScreenshot(e.dataTransfer.files[0])}}>
              <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e)=>selectScreenshot(e.target.files?.[0])}/>
              {screenshot ? <><img src={screenshot.preview} alt="Попередній перегляд підтвердження донату"/><div><b>{screenshot.file.name}</b><small>{(screenshot.file.size/1024/1024).toFixed(2)} МБ · зображення не є публічним</small><span><Button type="button" variant="secondary" onClick={()=>inputRef.current?.click()}>Замінити</Button><Button type="button" variant="ghost" onClick={()=>setScreenshot(null)}>Видалити</Button></span></div></> : <button type="button" onClick={()=>inputRef.current?.click()}><span><Icon name="plus"/></span><b>Підтвердження донату</b><small>Перетягни JPEG, PNG або WebP сюди чи обери файл · до 5 МБ</small></button>}
            </div>
            {error&&<p className="form-error">{error}</p>}{success&&<p className="success-message"><Icon name="check" size={15}/>{success}</p>}<p className="form-consent">Зображення використовується лише для перевірки заявки та доступне уповноваженому адміністратору. Перевірка пожертви відбувається окремо від платежу.</p><Button disabled={submitting}>{submitting?'Зберігаємо заявку…':'Надіслати заявку'}</Button></form></>}
      </section></div>
  </div>
}

function StatusPanel({ icon, title, text, tone }: { icon:string; title:string; text:string; tone:string }) {
  return <div className={`premium-status ${tone}`}><span><Icon name={icon}/></span><h2>{title}</h2><p>{text}</p></div>
}

export function AdminPage() {
  const { accounts, setAccounts, currentUser, setCurrentUser, premiumRequests, setPremiumRequests } = useStore()
  const [notes, setNotes] = useState<Record<string,string>>({})
  if (currentUser.accountRole !== 'admin') return <div className="page"><div className="empty-state large"><span><Icon name="lock"/></span><h2>Доступ заборонено</h2><p>Ця зона доступна лише адміністратору. У реальному продукті дозвіл обов’язково перевірятиме backend.</p></div></div>
  const review = (request: PremiumRequest, status: 'approved'|'rejected'|'revoked') => {
    const reviewNotes = notes[request.id]?.trim() || (status === 'approved' ? 'Перевірку завершено' : 'Потрібне додаткове підтвердження транзакції')
    setPremiumRequests(premiumRequests.map((r)=>r.id===request.id?{...r,status,reviewNotes,reviewedAt:new Date().toISOString(),reviewedBy:currentUser.id}:r))
    const targetEntry = Object.entries(accounts).find(([,account])=>account.id===request.userId)
    if (targetEntry) {
      const [email,target] = targetEntry
      const updated = {...target,premiumStatus:status==='approved'?'premium' as const:status==='rejected'?'rejected' as const:'free' as const}
      setAccounts({...accounts,[email]:updated})
      if (request.userId === currentUser.id) setCurrentUser(updated)
    }
  }
  return <div className="page admin-page"><div className="admin-warning"><Icon name="lock"/><span><b>Локальний перегляд</b> Цей frontend-екран не є безпечним механізмом перевірки пожертв. Реальний доступ і звірку має забезпечувати backend.</span></div><div className="page-title-row"><div><span className="eyebrow">Обмежена зона</span><h1>Premium-заявки</h1><p>{premiumRequests.filter((r)=>r.status==='pending').length} очікують перевірки</p></div></div>
    <div className="admin-requests">{premiumRequests.length ? premiumRequests.map((r)=><article key={r.id}><div className="request-head"><div><span className={`request-status ${r.status}`}>{r.status==='pending'?'На перевірці':r.status==='approved'?'Схвалено':r.status==='revoked'?'Відкликано':'Відхилено'}</span><h3>{r.submittedFullName}</h3><p>{r.accountEmail} · акаунт {r.userId}</p></div></div>{r.screenshotDataUrl&&<button className="admin-screenshot" onClick={()=>window.open(r.screenshotDataUrl,'_blank','noopener,noreferrer')}><img src={r.screenshotDataUrl} alt={`Підтвердження від ${r.submittedFullName}`}/><span><Icon name="search" size={15}/>Переглянути підтвердження</span></button>}<dl><div><dt>Файл</dt><dd>{r.screenshotFileName || 'Зображення'}</dd></div><div><dt>Подано</dt><dd>{new Date(r.submittedAt).toLocaleString('uk-UA')}</dd></div>{r.reviewedAt&&<div><dt>Переглянуто</dt><dd>{new Date(r.reviewedAt).toLocaleString('uk-UA')}</dd></div>}</dl><label className="field"><span>Нотатка адміністратора</span><textarea value={notes[r.id] ?? r.reviewNotes ?? ''} onChange={(e)=>setNotes({...notes,[r.id]:e.target.value})} placeholder="Результат ручної звірки або причина рішення"/></label><div className="request-actions">{r.status==='pending'&&<><Button variant="danger" onClick={()=>review(r,'rejected')}>Відхилити</Button><Button onClick={()=>review(r,'approved')}>Схвалити</Button></>}{r.status==='approved'&&<Button variant="danger" onClick={()=>review(r,'revoked')}>Відкликати доступ</Button>}</div></article>) : <div className="empty-state"><span><Icon name="check"/></span><h3>Заявок ще немає</h3><p>Нові запити з’являться тут після подання користувачами.</p></div>}</div>
  </div>
}
