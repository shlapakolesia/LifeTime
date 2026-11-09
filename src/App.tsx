import { useEffect, useState } from 'react'
import { StoreProvider, useStore } from './store'
import type { CalendarEvent, Page, Task } from './types'
import { Icon } from './components/Icons'
import { Avatar, Button, EventModal, TaskModal, Toast } from './components/UI'
import { CalendarPage, Overview, TasksPage } from './pages/CorePages'
import { FindTimePage, FriendsPage, GroupsPage } from './pages/FeaturePages'
import { AssistantPage, NotificationsPage, SettingsPage } from './pages/MiscPages'
import { AdminPage, LandingPage, PremiumPage } from './pages/PublicAndPremium'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { isCognitoConfigured } from './config'

const nav: {id:Page;label:string;icon:string}[] = [
  {id:'overview',label:'Огляд',icon:'overview'}, {id:'calendar',label:'Календар',icon:'calendar'}, {id:'tasks',label:'Завдання',icon:'tasks'},
  {id:'find',label:'Знайти час',icon:'find'}, {id:'friends',label:'Друзі',icon:'friends'}, {id:'groups',label:'Групи',icon:'groups'},
  {id:'assistant',label:'AI-помічник',icon:'assistant'}, {id:'notifications',label:'Сповіщення',icon:'bell'}, {id:'settings',label:'Налаштування',icon:'settings'},
]

function Logo() { return <div className="logo"><span className="logo-mark"><i/><i/></span><b>LifeTime</b></div> }

function Auth({ initialMode, onDone, onBack }: { initialMode: 'signin'|'signup'; onDone:(profile:{firstName?:string;lastName?:string;email:string;isAdmin:boolean})=>void; onBack:()=>void }) {
  const [mode,setMode]=useState<'signin'|'signup'|'forgot'|'onboarding'>(initialMode)
  const [step,setStep]=useState(0); const [loading,setLoading]=useState(false); const [error,setError]=useState('')
  const [recoverySent,setRecoverySent]=useState(false)
  const [form,setForm]=useState({first:'',last:'',email:''})
  const finish=()=>onDone({firstName:form.first||undefined,lastName:form.last||undefined,email:form.email,isAdmin:form.email.toLowerCase()==='admin@lifetime.local'})
  const submit=(e:React.FormEvent)=>{e.preventDefault();setError('');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))return setError('Введіть коректну email-адресу.');setLoading(true);setTimeout(()=>{setLoading(false);if(mode==='signup')setMode('onboarding');else if(mode==='forgot')setRecoverySent(true);else finish()},700)}
  if(mode==='onboarding') {
    const slides=[
      {icon:'spark',title:'Вітаємо у LifeTime',text:'Місце, де обов’язки не витісняють важливих людей.'},
      {icon:'calendar',title:'Плани й завдання разом',text:'Календар, дедлайни й щоденний фокус працюють як одна система.'},
      {icon:'check',title:'Твоя приватність — правило',text:'Друзі бачать, коли ти вільна, але не бачать деталей приватних подій.'},
      {icon:'find',title:'Зустрічі без переписок',text:'LifeTime порівнює зайняті проміжки й знаходить час, який справді підходить усім.'},
      {icon:'clock',title:'Коли твій активний час?',text:'Ми пропонуватимемо зустрічі лише в комфортні години.'},
    ]
    return <div className="auth-page onboarding"><div className="auth-brand"><button onClick={onBack}><Logo/></button></div><div className="onboarding-card"><div className="onboarding-progress">{slides.map((_,i)=><i className={i<=step?'active':''} key={i}/>)}</div><span className="onboarding-icon"><Icon name={slides[step].icon} size={30}/></span><small>Крок {step+1} із {slides.length}</small><h1>{slides[step].title}</h1><p>{slides[step].text}</p>{step===4&&<div className="active-hours"><label className="field"><span>Від</span><input type="time" defaultValue="08:00"/></label><span>—</span><label className="field"><span>До</span><input type="time" defaultValue="21:00"/></label></div>}<Button onClick={()=>step<slides.length-1?setStep(step+1):finish()}>{step===slides.length-1?'Відкрити LifeTime':'Продовжити'}<Icon name="arrow" size={17}/></Button><button className="text-button" onClick={finish}>Пропустити знайомство</button></div></div>
  }
  return <div className="auth-page"><section className="auth-visual"><div className="auth-brand"><button onClick={onBack}><Logo/></button></div><div className="auth-quote"><span className="eyebrow">Час на твоєму боці</span><h1>Роби важливе.<br/><em>Зустрічайся</em> з важливими.</h1><p>LifeTime допомагає організувати день і знайти спільний час без нескінченних повідомлень.</p></div><div className="auth-floating"><div><span>Сьогодні</span><b>Вільне вікно</b><small>16:00–18:30 · 2,5 години</small></div><div className="auth-avatars"><i>ОШ</i><i>СС</i><i>СШ</i></div></div></section>
    <section className="auth-form-wrap"><form className="auth-form" onSubmit={submit}>
      <span className="eyebrow">{mode==='signup'?'Новий початок':mode==='forgot'?'Відновлення доступу':'З поверненням'}</span><h2>{mode==='signup'?'Створити акаунт':mode==='forgot'?'Забули пароль?':'Увійти в LifeTime'}</h2><p>{mode==='forgot'?'Введіть email — підтвердження з’явиться на цьому екрані.':mode==='signup'?'Почни планувати життя у своєму ритмі.':'Твій час і твої люди вже чекають.'}</p>
      {mode==='signup'&&<div className="field-row"><label className="field"><span>Ім’я</span><input required value={form.first} onChange={(e)=>setForm({...form,first:e.target.value})} placeholder="Олеся"/></label><label className="field"><span>Прізвище</span><input required value={form.last} onChange={(e)=>setForm({...form,last:e.target.value})} placeholder="Шлапак"/></label></div>}
      <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})} placeholder="name@example.com"/></label>
      {recoverySent&&<p className="success-message"><Icon name="check" size={15}/>Готово. У реальному продукті ми надіслали б лист на цю адресу.</p>}
      {error&&<p className="form-error">{error}</p>}
      {mode==='signin'&&<button type="button" className="forgot-link" onClick={()=>setMode('forgot')}>Забули пароль?</button>}
      <Button className="auth-submit" disabled={loading}>{loading?'Зачекайте…':mode==='signup'?'Зареєструватися':mode==='forgot'?'Продовжити':'Увійти'}</Button>
      {mode!=='forgot'&&<><div className="auth-divider"><span>або</span></div><Button type="button" variant="secondary" className="google-button" onClick={()=>onDone({email:form.email||'google.user@lifetime.local',firstName:form.first||'Google',lastName:form.last||'User',isAdmin:false})}><b>G</b>Продовжити з Google</Button></>}
      {mode==='forgot'?<button type="button" className="switch-auth" onClick={()=>setMode('signin')}>Повернутися до входу</button>:<p className="switch-auth">{mode==='signin'?'Ще немає акаунта?':'Вже є акаунт?'} <button type="button" onClick={()=>{const next=mode==='signin'?'signup':'signin';setMode(next);history.replaceState({},'',next==='signup'?'/register':'/login')}}>{mode==='signin'?'Зареєструватися':'Увійти'}</button></p>}
      <button type="button" className="back-home" onClick={onBack}><Icon name="arrow" className="flip" size={14}/>На головну</button>
      <p className="auth-prototype-note">Зараз працює локальний адаптер без збереження паролів. У production вхід, Google та верифікацію email виконуватиме Amazon Cognito Managed Login через Authorization Code Flow із PKCE.</p>
    </form></section>
  </div>
}

function AppShell({ logout }: { logout:()=>void }) {
  const {users,currentUser,notifications}=useStore()
  const routeToPage: Record<string,Page> = {'/dashboard':'overview','/calendar':'calendar','/tasks':'tasks','/find-time':'find','/friends':'friends','/groups':'groups','/assistant':'assistant','/premium':'premium','/settings':'settings','/notifications':'notifications','/admin':'admin'}
  const pageToRoute: Record<Page,string> = {overview:'/dashboard',calendar:'/calendar',tasks:'/tasks',find:'/find-time',friends:'/friends',groups:'/groups',assistant:'/assistant',premium:'/premium',settings:'/settings',notifications:'/notifications',admin:'/admin'}
  const initialPage: Page = routeToPage[window.location.pathname] || 'overview'
  const [page,setPage]=useState<Page>(initialPage); const [mobile,setMobile]=useState(false)
  const [eventState,setEventState]=useState<{event?:CalendarEvent;prefill?:Partial<CalendarEvent>}|null>(null)
  const [taskState,setTaskState]=useState<Task|null|undefined>(undefined); const [toast,setToast]=useState('')
  const navigate=(requested:Page)=>{
    let p=requested
    if (requested==='assistant' && currentUser.premiumStatus!=='premium') p='premium'
    if (requested==='admin' && currentUser.accountRole!=='admin') p='overview'
    history.pushState({},'',pageToRoute[p]);setPage(p);setMobile(false);window.scrollTo({top:0,behavior:'smooth'})
  }
  useEffect(()=>{if(page==='assistant'&&currentUser.premiumStatus!=='premium')navigate('premium')},[currentUser.premiumStatus])
  useEffect(() => {
    const handleHistory = () => {
      const requested = routeToPage[window.location.pathname] || 'overview'
      if (requested === 'assistant' && currentUser.premiumStatus !== 'premium') { history.replaceState({}, '', '/premium'); setPage('premium'); return }
      if (requested === 'admin' && currentUser.accountRole !== 'admin') { history.replaceState({}, '', '/dashboard'); setPage('overview'); return }
      setPage(requested)
    }
    window.addEventListener('popstate', handleHistory)
    return () => window.removeEventListener('popstate', handleHistory)
  }, [currentUser.premiumStatus, currentUser.accountRole])
  const title=nav.find((n)=>n.id===page)?.label
  return <div className="app-shell">
    <aside className={`sidebar ${mobile?'open':''}`}><div className="sidebar-top"><Logo/><button className="mobile-close" onClick={()=>setMobile(false)}><Icon name="close"/></button></div>
      <nav>{nav.slice(0,3).map((n)=><NavItem {...n} active={page===n.id} onClick={()=>navigate(n.id)} key={n.id}/>)}<span className="nav-label">Спільний простір</span>{nav.slice(3,7).map((n)=><NavItem {...n} active={page===n.id} onClick={()=>navigate(n.id)} locked={n.id==='assistant'&&currentUser.premiumStatus!=='premium'} key={n.id}/>)}<span className="nav-label">Система</span>{nav.slice(7).map((n)=><NavItem {...n} active={page===n.id} onClick={()=>navigate(n.id)} count={n.id==='notifications'?notifications.filter((x)=>!x.read).length:0} key={n.id}/>)}{currentUser.accountRole==='admin'&&<><span className="nav-label">Адміністрування</span><NavItem id="admin" label="Premium-заявки" icon="lock" active={page==='admin'} onClick={()=>navigate('admin')}/></>}</nav>
      <div className="sidebar-card"><span><Icon name="spark"/></span><b>Знайди час<br/>для важливого</b><button onClick={()=>navigate('find')}>Почати <Icon name="arrow" size={14}/></button></div>
      <button className="user-menu" onClick={()=>navigate('settings')}><Avatar user={currentUser}/><span><b>{currentUser.firstName} {currentUser.lastName}</b><small>{currentUser.email}</small></span><Icon name="chevron" size={16}/></button>
    </aside>{mobile&&<div className="sidebar-scrim" onClick={()=>setMobile(false)}/>}
    <div className="main-shell"><header className="app-header"><button className="menu-button" onClick={()=>setMobile(true)}><Icon name="menu"/></button><div className="mobile-logo"><Logo/></div><span className="header-title">{title || (page==='premium'?'LifeTime Premium':'Адміністрування')}</span><div className="header-actions"><button className="icon-button notification-button" onClick={()=>navigate('notifications')} aria-label="Сповіщення"><Icon name="bell"/>{notifications.some((n)=>!n.read)&&<i/>}</button><button className="header-avatar" onClick={()=>navigate('settings')} aria-label="Відкрити профіль"><Avatar user={currentUser} size="sm"/></button><Button icon="plus" onClick={()=>setEventState({})}>Створити</Button></div></header>
      <main>
        {page==='overview'&&<Overview navigate={navigate} openEvent={()=>setEventState({})} openTask={()=>setTaskState(null)}/>}
        {page==='calendar'&&<CalendarPage openEvent={(prefill)=>setEventState({prefill})} editEvent={(event)=>setEventState({event})}/>}
        {page==='tasks'&&<TasksPage openTask={()=>setTaskState(null)} editTask={(t)=>setTaskState(t)}/>}
        {page==='find'&&<FindTimePage schedule={(prefill)=>setEventState({prefill})}/>}
        {page==='friends'&&<FriendsPage goFind={()=>navigate('find')}/>}
        {page==='groups'&&<GroupsPage goFind={()=>navigate('find')}/>}
        {page==='assistant'&&<AssistantPage goCalendar={()=>navigate('calendar')} goFind={()=>navigate('find')}/>}
        {page==='premium'&&<PremiumPage/>}
        {page==='admin'&&<AdminPage/>}
        {page==='notifications'&&<NotificationsPage/>}
        {page==='settings'&&<SettingsPage logout={logout}/>}
      </main>
    </div>
    <nav className="mobile-nav">{nav.slice(0,5).map((n)=><button className={page===n.id?'active':''} onClick={()=>navigate(n.id)} key={n.id}><Icon name={n.icon}/><span>{n.label.split(' ')[0]}</span></button>)}</nav>
    {eventState&&<EventModal event={eventState.event} prefill={eventState.prefill} onClose={()=>setEventState(null)} onSaved={setToast}/>}
    {taskState!==undefined&&<TaskModal task={taskState||undefined} onClose={()=>setTaskState(undefined)} onSaved={setToast}/>}
    {toast&&<Toast text={toast} onDone={()=>setToast('')}/>}
  </div>
}

function NavItem({id,label,icon,active,onClick,count=0,locked=false}:{id:Page;label:string;icon:string;active:boolean;onClick:()=>void;count?:number;locked?:boolean}) {
  return <button className={`nav-item ${active?'active':''}`} onClick={onClick}><Icon name={icon}/><span>{label}</span>{locked&&<i className="premium-lock"><Icon name="crown" size={12}/></i>}{count>0&&<i className="nav-count">{count}</i>}</button>
}

function Root() {
  const {accounts,currentUser,setCurrentUser}=useStore()
  const { isAuthenticated, signInLocal, signOut } = useAuth()
  const protectedPaths=['/dashboard','/calendar','/tasks','/find-time','/friends','/groups','/assistant','/premium','/settings','/notifications','/admin']
  const initialPublic = window.location.pathname === '/login' || protectedPaths.includes(window.location.pathname) ? 'signin' : window.location.pathname === '/register' ? 'signup' : null
  const [authMode,setAuthMode]=useState<'signin'|'signup'|null>(initialPublic)
  useEffect(()=>{if(!isAuthenticated&&protectedPaths.includes(window.location.pathname)){history.replaceState({},'','/login');setAuthMode('signin')}},[isAuthenticated])
  useEffect(() => {
    const handleHistory = () => {
      if (window.location.pathname === '/login') setAuthMode('signin')
      else if (window.location.pathname === '/register') setAuthMode('signup')
      else if (!protectedPaths.includes(window.location.pathname)) setAuthMode(null)
    }
    window.addEventListener('popstate', handleHistory)
    return () => window.removeEventListener('popstate', handleHistory)
  }, [])
  const openAuth=(mode:'signin'|'signup')=>{history.pushState({},'',mode==='signup'?'/register':'/login');setAuthMode(mode)}
  const done=async(profile:{firstName?:string;lastName?:string;email:string;isAdmin:boolean})=>{
    const email=profile.email.toLowerCase()
    const stored=accounts[email]
    const next=stored || {...currentUser,id:profile.isAdmin?'local-admin':`local-${Date.now()}`,firstName:profile.firstName||'Користувач',lastName:profile.lastName||'LifeTime',email:profile.email,premiumStatus:profile.isAdmin?'premium':'free',accountRole:profile.isAdmin?'admin':'user'}
    setCurrentUser({...next,firstName:profile.firstName||next.firstName,lastName:profile.lastName||next.lastName,email:profile.email,initials:`${profile.firstName?.[0]||next.firstName[0]}${profile.lastName?.[0]||next.lastName[0]}`.toUpperCase(),accountRole:profile.isAdmin?'admin':'user'})
    await signInLocal(profile);history.replaceState({},'','/dashboard')
  }
  const logout=async()=>{await signOut();setAuthMode(null);history.replaceState({},'','/')}
  const back=()=>{setAuthMode(null);history.replaceState({},'','/')}
  if(window.location.pathname==='/auth/callback') return <AuthCallbackPage/>
  if(isAuthenticated) return <AppShell logout={logout}/>
  return authMode?<Auth key={authMode} initialMode={authMode} onDone={done} onBack={back}/>:<LandingPage openAuth={openAuth}/>
}

function AuthCallbackPage() {
  return <div className="callback-page"><span><Icon name="lock"/></span><h1>Завершуємо вхід</h1><p>{isCognitoConfigured?'Обробляємо відповідь Amazon Cognito…':'Cognito ще не налаштовано. Скористайся локальним входом.'}</p><Button onClick={()=>{history.replaceState({},'','/login');location.reload()}}>Повернутися до входу</Button></div>
}

export default function App() { return <AuthProvider><StoreProvider><Root/></StoreProvider></AuthProvider> }
