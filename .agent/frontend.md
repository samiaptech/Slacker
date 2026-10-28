# TeamNest Frontend ki Rahnumai

Yeh file TeamNest web frontend ki musalsal wazahat hai: app kya karta hai, uske bunyadi hisse
mil kar kaise chalte hain, har feature ki files kahan hain, kya verify hua hai, aur abhi kya
planned hai. Frontend mein tabdeeli ho to isi file ko update karo. `AGENTS.md` ko repository
ke mustaqil rules aur agents ke darmiyan ownership ke liye rakho. Chat mein lambi wazahat
dobara likhne ke bajaye user ko chhota progress/status paigham do.

## 1. Product aur frontend architecture

Web app mein product ka naam TeamNest nazar aata hai. Repository aur kuch internal storage
identifiers compatibility ki wajah se purane Nutshyll/Slacker naam rakhte hain. Frontend
Next.js app `apps/web` mein hai; product ke features `apps/web/features/` ke andar hain aur
generic UI controls `packages/ui` se aate hain. Mukhtalif apps ke darmiyan API aur realtime
contracts `packages/types` own karta hai. Frontend response ko UI mein dikhane se pehle apni
boundary par validate karta hai.

App Next.js App Router istemal karti hai. Login ke baad workspace ke tamam routes ek shared
layout istemal karte hain. Is se member channels, DMs, profile aur member pages ke darmiyan
jaye to workspace access, navigation aur realtime state dobara mount nahi hote:

- [App routes ka shared layout](apps/web/app/(app)/layout.tsx)
- [Root layout aur request ke waqt CSP rendering](apps/web/app/layout.tsx)
- [Workspace home page](apps/web/app/(app)/page.tsx)
- [Web app ka naam aur description](apps/web/constants/application.ts)
- [Web API configuration](apps/web/config/api.ts)

UI pehle `packages/ui` ke shared shadcn primitives se banti hai, phir uske upar TeamNest ke
workspace aur feature components aate hain. Is tarah generic buttons, dialogs, inputs, tooltips
waghera product ke khaas behavior se alag rehte hain.

## 2. Design aur app ka bunyadi shell

Chat workspace ko diye gaye Nutshyll Figma reference ke mutabiq banaya gaya, phir asal routes,
API data, mobile behavior aur mojooda architecture ke saath adjust kiya gaya. App mein forest
green workspace rail/sidebar, halka garam conversation surface, compact message rows aur alag
channel About panel hai. Live channel ko prototype jaisa dikhane ke liye koi sample messages
gharr kar nahi dikhaye gaye.

- [Workspace shell, rail, sidebar, header, search, notifications aur workspace actions](apps/web/features/channels/components/channel-workspace.tsx)
- [Workspace access shuru karna aur membership select karna](apps/web/features/identity/components/workspace-access.tsx)
- [Workspace context aur active workspace ki state](apps/web/features/workspace-foundation/components/workspace-context.tsx)
- [Workspace runtime ko compose karna](apps/web/features/workspace-foundation/components/workspace-foundation.tsx)
- [Global theme, full-screen layout, responsive behavior, scrollbars aur transitions](apps/web/app/globals.css)
- [Workspace aur route loading shell](apps/web/app/(app)/loading.tsx)

Workspace shell mein workspace switcher, channel aur DM lists, member access, profile links,
responsive sidebar controls, creation menus aur shared main header shamil hain. Channel aur DM
ka content load hote waqt shared shell screen par rehta hai.

Workspace switcher har workspace ko uske pehle harf se dikhata hai. Harf par mouse le jane ya
keyboard se focus karne par shared tooltip mein poora workspace naam aata hai. Click se
workspace switch hota rehta hai:

- [Workspace rail aur tooltip ka istemal](apps/web/features/channels/components/channel-workspace.tsx)
- [Dobara istemal hone wala tooltip primitive](packages/ui/src/primitives/tooltip.tsx)

Workspace badalne par purane channel ka URL pehle workspace home par replace hota hai; phir
naye workspace ki joined-channel list load hone ke baad `general` khulta hai. Agar `general`
na mile to pehla joined channel khulta hai, aur agar koi joined channel na ho to workspace
home par rehta hai. Is se purane workspace ka channel ID naye workspace ke context mein khul
kar “channel unavailable” error nahi deta. Notification se workspace kholne ka behavior
alag rehta hai, kyunki usay notification ke asal channel ya DM par jana hota hai.

- [Workspace switch ke baad default channel navigation](apps/web/features/channels/components/channel-workspace.tsx)

Workspace se leave karne par client ab `router.replace("/")` se internal route badalta hai.
Agar doosra workspace hai to uski access pehle fetch karke mounted workspace context update hota
hai; koi workspace na bache to create-workspace flow khulta hai. Auth expiry par sign-in route
par client navigation hoti hai, aur leave dialog successful switch ke baad band hota hai. Is se
relative `window.location.assign("/")` lint warning bhi resolve hoti hai.

- [Workspace access, leave ke baad aglay workspace par jana](apps/web/features/identity/components/workspace-access.tsx)
- [Leave confirmation dialog](apps/web/features/workspace-foundation/components/workspace-leave-action.tsx)

Sidebar search type karte hi visible lists ko filter nahi karti. Iske bajaye ek fixed search
dialog khulta hai. Search input ki state dialog ke andar rehti hai, jis se layout hilta nahi aur
bila zaroorat workspace dobara render nahi hota:

- [Workspace search dialog](apps/web/features/channels/components/workspace-search-dialog.tsx)
- [Workspace shell mein search dialog ka connection](apps/web/features/channels/components/channel-workspace.tsx)

## 3. Channels aur About panel

Channel route channel metadata load aur validate karta hai, phir conversation ko channel profile
panel ke saath jorta hai. Bari screen par About panel conversation ke saath hota hai. Shared
header mein channel name click karne se panel khulta/band hota hai; iske liye doosra channel-name
header nahi banaya gaya. Chhoti screen par channel name alag About route kholta hai, jis se
conversation ke liye zyada jagah rehti hai. Private channels mein About view ke andar member
controls hain; public channel ke members pehle se mojood workspace-member data se aate hain.

- [Channel route](apps/web/app/(app)/channels/[channelId]/page.tsx)
- [Mobile aur desktop ka dedicated About route](apps/web/app/(app)/channels/[channelId]/about/page.tsx)
- [Channel metadata, loading/error states, conversation aur panel ki composition](apps/web/features/channels/components/channel-page.tsx)
- [Channel About panel](apps/web/features/channels/components/channel-profile-panel.tsx)
- [About content aur members ki presentation](apps/web/features/channels/components/channel-profile-content.tsx)
- [Private channel membership controls](apps/web/features/channels/components/channel-members-panel.tsx)
- [About panel toggle ki shared state](apps/web/features/channels/components/channel-profile-toggle-context.tsx)
- [Channel banane ka dialog](apps/web/features/channels/components/create-channel-dialog.tsx)

Channel metadata load hote waqt loading state sirf conversation pane mein aati hai aur shared
workspace navigation mounted rehti hai. Channel error bhi isi pane mein dikhaya jata hai,
recovery ke saath; poora app shell replace nahi hota.

## 4. Channel aur direct-message conversations

Channel aur direct-message timelines ek jaisa message row style, date dividers, attachment
cards, delivery states, loading behavior aur composer patterns istemal karte hain. Har route
conversation metadata aur history ke pehle limited page ko load karta hai; phir pehle se
connected Socket.IO connection par naye messages, typing, deletes aur access revoke hone ke
events sunta hai. Purani history zaroorat par load hoti hai; purane messages jorne ke baad
viewport ka pehla nazar aane wala message wahi jagah par rehta hai.

- [Channel conversation, history, realtime events, composer aur message actions](apps/web/features/channels/components/channel-messages.tsx)
- [Channel message row](apps/web/features/channels/components/channel-message-item.tsx)
- [Channel system messages, jaise member ke jane ki entry](apps/web/features/channels/components/channel-system-message-item.tsx)
- [Channel realtime provider](apps/web/features/channels/components/channel-realtime-provider.tsx)
- [Direct-message route](apps/web/app/(app)/messages/[conversationId]/page.tsx)
- [DM conversation, history, realtime events, composer aur actions](apps/web/features/direct-messages/components/direct-message-page.tsx)
- [Direct-message row](apps/web/features/direct-messages/components/direct-message-item.tsx)
- [Direct-message loading skeleton](apps/web/features/direct-messages/components/direct-message-loading.tsx)
- [Timeline scroll anchor ko capture aur restore karna](apps/web/features/conversation-history/scroll-position.ts)

Mobile/browser back agar purane workspace ka ya ab delete ho chuka DM URL khol de aur API
`403`/`404` de, to DM page us stale history entry ko workspace home se replace karti hai.
Is se “Direct message unavailable” error par phansne ke bajaye member workspace mein wapas
aa jata hai. Server/network errors aur setup error ab bhi apna retryable message dikhate hain.

Message rows ko memoized feature components mein alag kiya gaya aur date grouping bhi memoize
ki gayi. Is se composer mein type karne par poori timeline dobara nahi banti. Naya realtime ya
API message usi pending send se match hota hai aur uski jagah leta hai, duplicate row nahi banta.

### Fori message bhejna aur errors sambhalna

Member message bhejte hi frontend pending row foran dikhata hai. Row par sending, sent ya failed
state nazar aati hai. Send fail ho to draft aur selected files zaya kiye baghair retry kiya ja
sakta hai. Jab API ya Socket.IO saved message bhejta hai to matching pending row replace hoti
hai, duplicate nahi banti.

- [Pending message ka model aur matching helpers](apps/web/features/conversation-history/pending-message.ts)
- [Delivery indicator](apps/web/features/conversation-history/message-delivery-indicator.tsx)
- [Channel mein fori send ka integration](apps/web/features/channels/components/channel-messages.tsx)
- [DM mein fori send ka integration](apps/web/features/direct-messages/components/direct-message-page.tsx)

### Attachments aur image viewing

Channel aur DM composers ek message mein 5 tak supported files, har ek zyada se zyada 10 MiB,
qabool karte hain. Sirf text bhejne par purani JSON request chalti rehti hai; files hon to
multipart `text` aur baar-baar `files` fields bheje jate hain. Frontend optional attachment
metadata parse karta hai. Download ke liye API ka authorized `downloadUrl` workspace
credentials aur same-origin checks ke saath istemal hota hai. Images conversation mein preview
hoti hain aur full-screen viewer mein khulti hain; documents download cards rehte hain. Lambi
history ki tamam images foran load na hon, isliye preview viewport ke qareeb aane par
`IntersectionObserver` se load hoti hai.

- [Channel request deduplication aur send helper](apps/web/features/channels/components/channel-message-request.ts)
- [Attachment cards, authorized download, lazy preview aur image viewer](apps/web/features/conversation-history/message-attachment-list.tsx)
- [Channel composer aur attachment integration](apps/web/features/channels/components/channel-messages.tsx)
- [DM composer aur attachment integration](apps/web/features/direct-messages/components/direct-message-page.tsx)
- [Channel message response schema](apps/web/features/channels/types/channel-message-response.ts)
- [DM response schema](apps/web/features/direct-messages/types/direct-message-response.ts)

Upload policy, assets ko store karna aur download authorization backend ki zimmedari hai.
Frontend sirf tai-shuda API contract istemal karta hai; UI khud ko in security checks ka malik
nahi kehti.

### Message delete karne ke actions

UI available “Delete for me” aur “Delete for everyone” options bhejti hai. Kamyab deletion ke
baad message local timeline se hat jata hai; server reject kare to user ko samajh aane wala
error dikhaya jata hai. Kaun delete kar sakta hai aur deletion permanently save karna backend
ki zimmedari hai.

- [Shared message action UI](apps/web/features/conversation-history/message-actions.tsx)
- [Delete response aur error handling](apps/web/features/conversation-history/message-delete-response.ts)
- [Channel mein deletion integration](apps/web/features/channels/components/channel-messages.tsx)
- [DM mein deletion integration](apps/web/features/direct-messages/components/direct-message-page.tsx)

### Emoji reactions ka visual design

Channel aur DM message rows par pehle chhota emoji button, message ke text ki usi row mein
nazar aata hai. Us button ko click karne par paanch aam emoji aur `+` ek line mein khulte hain;
`+` se 25 emoji ka 6-column picker khulta hai. Select karte hi picker band hota hai. Message
reactions ab API response se count aur `reactedByMe` state dikhati hain; channel aur DM clients
reaction update ke realtime events bhi sunte hain. `message-reaction-request.ts` dono routes ko
workspace session ke saath call karta hai.

Reaction select/remove karne par count, emoji aur apni selected state API ka wait kiye baghair
foran update hote hain. Request fail ho to purani state restore hoti hai; pending dauran aane wali
realtime state rollback ke waqt preserve hoti hai. API response final state ko reconcile karta hai.

Kisi existing emoji chip par click karne se ab reaction toggle nahi hota; ek notification-style
popover khulta hai. Is mein har reacting member ka naam baen aur uska emoji daen nazar aata hai.
Member list scroll ho sakti hai, aur API ki user limit poori ho to extra members ka note dikhata
hai. Agar viewer ne woh emoji react kiya ho to uske naam ke neeche `Tap to remove` aata hai;
us poori row par click se reaction hat kar popover band hota hai. Agar API ki truncated list mein
viewer ka record na aaye, UI authenticated workspace user se apni row dikhati hai. Naya reaction
quick row ya `+` picker se select hota hai.

**Copilot backend update:** Backend toggle ab ek transaction mein purani active reaction band
karke naya emoji select karta hai; wohi emoji dobara chunne se reaction remove hoti hai. Partial
unique index har message par member ki ek active reaction enforce karta hai, aur initializer purane
duplicates mein latest `updatedAt` wala rakhta hai. API suite 163 passed / 2 optional Mongo tests
skipped; API/shared-types typecheck, focused lint aur diff check pass hue. Test karne se pehle
repo root se `pnpm run initialize` chalao aur API restart karo. Frontend “Tap to remove” row wahi
toggle endpoint istemal karti hai; frontend code ne backend badlaav nahi kiya.

Local populated channel mein pehle picker aur emoji-row placement dekhe gaye the. Naye API-integrated
design ko is browser session mein workspace-access loading error ki wajah se recheck nahi kiya ja
saka. Web channel/DM parsers ab reactions validate karke missing legacy values ko empty lists mein
normalize karte hain; optimistic messages bhi empty reaction lists se shuru hote hain. Notification
test fixture ki stale types durust ki gayi hain. Web typecheck, focused lint, notification regression
test aur production build pass hue. `@workspace/types` apna runtime entrypoint `dist` se deta hai,
is liye `apps/web` build pehle us package ko compile karta hai; clean `packages/types/dist` se
production build verify hua. Full web test runner mein chaar files abhi `ERR_PACKAGE_PATH_NOT_EXPORTED`
se fail hoti hain, jabke 13 tests pass hote hain; live MongoDB/browser verification abhi baqi hai.

- [Shared reaction picker aur chips](apps/web/features/conversation-history/message-reactions.tsx)
- [Reaction options aur toggle state](apps/web/features/conversation-history/message-reaction-state.ts)
- [Channel message row](apps/web/features/channels/components/channel-message-item.tsx)
- [DM message row](apps/web/features/direct-messages/components/direct-message-item.tsx)

## 5. Messages mein search

Workspace search dialog channels, direct conversations, logon aur messages ko dhoondhta hai.
Message search API request 300 ms debounce hoti hai; purani request abort hoti hai aur uska late
response naye query ko overwrite nahi karta. Results pages mein aate hain; har matching message apne
context ke saath alag selectable result hota hai. Result select karne par dialog band hota,
app mutaliqa channel ya DM par jati, zaroorat par purani history laati, phir us message tak
scroll karke usay thori dair highlight karti hai. Target validate karke sirf ek baar consume
hota hai, taake aglay render par dobara redirect na ho.

- [Search dialog aur result selection](apps/web/features/channels/components/workspace-search-dialog.tsx)
- [Message result ki presentation](apps/web/features/message-search/components/search-message-results.tsx)
- [Debounced search request aur pagination](apps/web/features/message-search/use-message-search.ts)
- [Validate hone wala one-time search target](apps/web/features/message-search/search-target.ts)
- [Timeline navigation, purani history, focus aur highlight](apps/web/features/message-search/use-message-search-jump.ts)
- [Message-search response validation](apps/web/features/message-search/types/message-search-response.ts)
- [Search integration tests](apps/web/tests/message-search.test.ts)

Search ka authorization scope, rate limits, indexes aur result bounds API sambhalti hai. UI
search experience sambhalti hai aur sirf shared contract mein manzoor-shuda response fields
dikhati hai.

## 6. Notifications aur unread state

Notification bell ek compact, right-aligned inbox kholta hai jo poori chat ko nahi dhakhta.
Client notification pages aur unread count load karta, typed Socket.IO notification events
sunta, purane responses ko naye local/socket state par qabza nahi karne deta, items ko read mark
karne deta aur channel ya DM tak le jata hai. Workspace list mein unread indicators bhi aate
hain. Conversation history kholne par mutaliqa local notifications read mark hoti hain.

- [Notification inbox UI](apps/web/features/notifications/notification-center.tsx)
- [Notification fetch, realtime merge, pagination aur read state](apps/web/features/notifications/use-notifications.ts)
- [Purane response ko rokne wala guard](apps/web/features/notifications/notification-load-state.ts)
- [Notification response aur event validation](apps/web/features/notifications/types/notification-response.ts)
- [Workspace header, unread navigation aur notification integration](apps/web/features/channels/components/channel-workspace.tsx)
- [Notification tests](apps/web/tests/notifications.test.ts)

API notifications save karti aur sirf mutaliqa recipients ko events bhejti hai. Message/channel
events, authorization, persistence aur migration backend ki ownership hain; web app in contracts
ko consume karti hai.

Channel conversation ke upar alag Live/refresh strip hata di gayi. Ab compact connection
status aur refresh button main header mein notification icon ke paas hain. Refresh button
feature context ke zariye active channel ki timeline reload karta hai. About route par yeh
button nahi hota, kyunki wahan message timeline mounted nahi hoti.

- [Header status, refresh button aur providers ki composition](apps/web/features/channels/components/channel-workspace.tsx)
- [Refresh handler context](apps/web/features/channels/components/channel-message-refresh-context.tsx)
- [Channel history reload registration](apps/web/features/channels/components/channel-messages.tsx)

## 7. Profiles, members aur workspace membership

Account profile mein workspace theme wala identity card, editable display name/title, email
visibility controls aur admin invite settings hain. Doosre members ke profiles mein identity,
role, member-since, ijazat-shuda email/title details aur alag admin management controls hain.
Loading, unavailable, retry aur unauthorized states main content pane ke andar rehti hain.

- [Account profile aur settings](apps/web/features/identity/components/profile-page.tsx)
- [Member profile route](apps/web/app/(app)/members/[userId]/page.tsx)
- [Member profile data, loading state aur controls](apps/web/features/identity/components/workspace-member-profile.tsx)
- [Member identity card](apps/web/features/identity/components/workspace-member-profile-card.tsx)
- [Member management controls](apps/web/features/identity/components/workspace-member-management.tsx)
- [Sign-in UI](apps/web/features/identity/components/sign-in.tsx)
- [Invitation UI](apps/web/features/identity/components/workspace-invitation.tsx)

Workspace options mein leave action aur confirmation dialog hai. Dialog menu band hone ke baad
bhi mounted rehta hai. Kamyab leave ke baad app maloom doosre workspace ko select karti hai;
agar koi baqi na ho to create-workspace flow par laut jati hai.

- [Workspace leave action](apps/web/features/workspace-foundation/components/workspace-leave-action.tsx)
- [Workspace context aur leave result handling](apps/web/features/workspace-foundation/components/workspace-context.tsx)
- [Workspace access aur selected workspace ko save karna](apps/web/features/identity/components/workspace-access.tsx)

## 8. Mobile, loading aur responsive behavior

Login ke baad shell viewport ki poori jagah leta hai. Chhoti screen par navigation sidebar
overlay ban jati hai jo khul aur band ho sakti hai. Channel About ke liye alag route hai, taake
conversation ko jagah mile. `visualViewport` hook mobile keyboard ke upar nazar aane wali
screen ka size leta hai, jis se fixed app shell aur composer keyboard ke saath adjust hote hain.
Channel, DM, workspace, profile aur member loading states sirf mutaliqa content surface par
hoti hain; shared rail/sidebar stable rehti hai.

- [Mobile viewport aur keyboard sizing](apps/web/features/channels/components/use-app-visual-viewport.ts)
- [Responsive layout, sidebar, chat aur scroll styles](apps/web/app/globals.css)
- [Channel aur mobile About composition](apps/web/features/channels/components/channel-page.tsx)
- [DM skeleton](apps/web/features/direct-messages/components/direct-message-loading.tsx)
- [Workspace route skeleton](apps/web/app/(app)/loading.tsx)
- [Profile/member content pane sizing](apps/web/features/channels/components/channel-workspace.tsx)

Scrollbar patli aur muted style mein hai, track transparent hai; scrolling browser ke native
behavior se hoti hai. Purani history jorne se pehle visible message ka anchor capture aur baad
mein restore hota hai, taake padhne ki jagah jump na kare.

## 9. Stability, performance aur security ka kaam

- **Shell ko mounted rakhna:** Home page authenticated `(app)` route group mein le gaye, taake
  channel par jane se workspace access aur realtime shell dobara mount na ho. Dekho [shared
  layout](apps/web/app/(app)/layout.tsx) aur [workspace home](apps/web/app/(app)/page.tsx).
- **History ki repeated requests ghatana:** Ek jaisi in-flight channel-history requests ko
  unke scope ke mutabiq deduplicate kiya jata hai; complete ho chuke responses cache nahi
  hote. Handoff mein browser run ke mutabiq initial history requests paanch se ek ho gayin.
  Dekho [channel request helper](apps/web/features/channels/components/channel-message-request.ts).
- **Bila zaroorat list dobara render na karna:** Message rows aur date grouping memoized hain,
  isliye composer mein type karne se poori timeline dobara nahi banti. Dekho [channel messages](apps/web/features/channels/components/channel-messages.tsx), [channel row](apps/web/features/channels/components/channel-message-item.tsx) aur [DM row](apps/web/features/direct-messages/components/direct-message-item.tsx).
- **Bootstrap ki duplicate fetch rokna:** Wapas aane wale workspace sessions saved access ko
  workspace list ke saath load karte hain. Dekho [workspace access](apps/web/features/identity/components/workspace-access.tsx).
- **Notification count ko stable rakhna:** Socket.IO pehli baar connect ho to notification
  inbox foran dobara fetch nahi hota; reconnect par inbox aur unread count refresh hote hain.
  Dekho [notification state](apps/web/features/notifications/use-notifications.ts).
- **Content Security Policy (CSP):** `proxy.ts` har request ke liye nonce banata aur restrictive
  CSP lagata hai. Development `style-src-elem` mein nonce ke saath `unsafe-inline` rakhne se
  browser inline-style allowance ignore kar raha tha; dev policy ab inline style elements ke liye
  `'self' 'unsafe-inline'` use karti hai, jabke production nonce-based hi rehti hai. Dekho [proxy](apps/web/proxy.ts), [policy builder](apps/web/config/security-policy.ts) aur [policy tests](apps/web/tests/security-policy.test.ts).
- **Brand consistency:** User ko nazar aane wala app metadata, shell/loading labels aur profile
  copy `TeamNest` use karte hain. Purane `nutshyll.*` browser storage keys aur backend storage/
  provider names saved state aur assets ko bachane ke liye waise hi rakhe. Dekho [app brand config](apps/web/constants/application.ts), [shell](apps/web/features/channels/components/channel-workspace.tsx) aur [workspace access](apps/web/features/identity/components/workspace-access.tsx).

## 10. Tests aur mojooda verification

Current handoff mein frontend validation ke taur par web tests, TypeScript checks, focused
ESLint, pehle ke full web lint/build aur `git diff --check` darj hain. Performance update ke
handoff mein us update ke liye 27 web tests, typecheck, focused lint aur build pass report hue.
Uske baad ki chhoti UI tabdeeliyon ko alag check kiya gaya:

- Channel Live/refresh controls ko primary header mein le jana: TypeScript check aur diff check
  pass hue. Focused ESLint complete nahi hua, kyunki DNS failure ke dauran pinned pnpm release
  fetch nahi ho saki aur direct ESLint run atak gaya.
- TeamNest web branding: TypeScript check aur diff check pass hue.
- Workspace naam ke tooltips: TypeScript check aur diff check pass hue; focused ESLint atak
  gaya tha aur rok diya gaya.

Yeh daawa nahi ke har mojooda unstaged tabdeeli full production build se pass hui hai. Kuch
browser verification bhi baqi hai. Khaas taur par is session mein browser tool ne local browser
access disabled bataya, isliye latest page reload ko yahan se alag measure nahi kar sake. User
ne apne local reload ke liye taqreeban 3 seconds tak report kiye; is se pehle handoff mein full
reload 4–5 seconds aur pehle se listed channels ke darmiyan switch taqreeban 1.25 seconds tha.
Yeh alag runs ki observations hain, controlled benchmark ya P95 nahi. Production navigation
timing aur live database query plan verify nahi hua.

- Is console report mein Chrome extension ka `content.js` CSP error TeamNest page ke code se
  nahi aata; React DevTools message sirf development tip hai. `[HMR] connected` batata hai ke
  Next.js hot reload chal raha hai. Frontend dev CSP fix kiya gaya, lekin local API terminal
  session attached nahi thi: `/channels/:id/messages` ka HTTP 500 aur Socket.IO handshake close
  ka asal backend exception yahan se verify nahi hua. Backend owner se API terminal ka pehla
  exception mangwao; API source mein Codex ne koi tabdeeli nahi ki. `git diff --check` pass hua;
  pnpm ke zariye focused ESLint network/tool wait mein atka aur rok diya gaya; tests nahi chalaye.

Mutaliqa frontend tests:

- [Home route integration test](apps/web/tests/integration/home-page.test.tsx)
- [Channel UI/data tests](apps/web/tests/channels.test.ts)
- [Conversation history tests](apps/web/tests/conversation-history.test.ts)
- [Message search tests](apps/web/tests/message-search.test.ts)
- [Notification tests](apps/web/tests/notifications.test.ts)
- [Workspace response tests](apps/web/tests/workspace-response.test.ts)
- [Attachment request helper tests](apps/web/features/channels/components/channel-message-request.test.ts)
- [CSP tests](apps/web/tests/security-policy.test.ts)

## 11. Backend ki boundary aur aglay planned features

Codex web layout, visual design, accessibility aur client interactions sambhalta hai. Copilot/
backend endpoints ka behavior, validation, persistence, authorization, migrations aur API/
realtime contracts own karta hai. Frontend integration se pehle request/response aur event shapes
coordinate karo; frontend task ke andar backend source edit na karo.

Team ke aglay feature ideas:

1. **Emoji reactions:** Message row par controls aur counts se shuru karo; UI se pehle channel/DM
   contract aur realtime event backend owner se tay karo.
2. **Apna message edit karna — frontend aur backend implementation tayyar:** Neeche current UI
  aur API handoff diya hai; populated live workspace verification pending hai.
3. **Har channel ki notification settings:** `All / Mentions only / Muted` behavior tay karo;
   yeh bhi ke preference har user ki alag hogi aur devices ke darmiyan save rahegi ya nahi.
4. **Saved messages:** Bookmark sirf us member ke liye private ho jo save kare; source channel/DM
   par wapas jane ka rasta do.
5. **Threads:** Isay alag plan karo, kyunki storage, history, search, notifications, unread,
   realtime aur mobile UI sab mutasir honge. Tay karo nesting sirf ek level ki hogi ya nahi, aur
   replies main timeline mein bhi dikhengi ya sirf thread mein.

### Message editing — frontend implementation aur backend handoff

Channel aur DM dono mein sirf apne text messages par `Edit message` action dikhta hai.
Attachment-only messages editable nahi. Inline editor current text prefill karta hai, Unicode
characters ka 4,000 limit/count dikhata hai, `Escape` se cancel aur `Ctrl/Cmd+Enter` se save
karta hai. Blank aur unchanged text save nahi hota.

Save API ko `PATCH` bhejne se pehle message row foran update hoti hai. Failure par asal text
restore hota aur draft editor mein rehta hai. `409 message_edit_conflict` par latest history
reload hoti hai taake draft dobara newest version par save ki ja sake. Successful response
`editedAt` ke mutabiq `Edited` label dikhata hai. Channel/DM dono page `channel:message:updated`
aur `direct-message:updated` realtime events ko runtime schema se parse karke active row update
karti hain; API mutation primary source of truth rehti hai.

- [Shared inline editor, API error mapping aur typed realtime listener](apps/web/features/conversation-history/)
- [Shared message-edit state aur optimistic save/rollback](apps/web/features/conversation-history/use-message-edit.ts)
- [Channel edit action aur API integration](apps/web/features/channels/components/channel-messages.tsx)
- [DM edit action aur API integration](apps/web/features/direct-messages/components/direct-message-page.tsx)
- [Channel aur DM row par editor/Edited label](apps/web/features/channels/components/channel-message-item.tsx), [DM row](apps/web/features/direct-messages/components/direct-message-item.tsx)

Focused web TypeScript check aur mutaliqa frontend files ka ESLint pass hua; workspace access
ka `no-location-assign-relative-destination` warning ab nahi aata. `git diff --check` bhi pass
hua. Frontend tests nahi chalaye gaye. Changes local aur uncommitted hain.

**Backend handoff complete:** `PATCH /channels/:channelId/messages/:messageId` aur
`PATCH /direct-messages/:conversationId/messages/:messageId` ab author-only edits, current
membership/participation checks, atomic `expectedEditedAt` conflict detection, `editedAt`
persistence, complete message responses, aur `channel:message:updated` /
`direct-message:updated` realtime events implement karte hain. Stale writes return `409
message_edit_conflict`; non-author attempts return `403 message_edit_forbidden`. Search reads
the canonical stored text; edits do not change unread state or conversation ordering. API tests,
typecheck, build, and focused lint pass. A live MongoDB/browser verification remains pending;
before deployment, run both channel and direct-message initializers (or the aggregate
initializer) to update their strict validators. Frontend owner: verify save, conflict recovery,
and realtime synchronization in a populated workspace after API deployment.
## 12. Frontend files ka naqsha

| Zimmedari | Bunyadi code |
| --- | --- |
| App routes aur login ke baad shared shell | [`apps/web/app/(app)/`](apps/web/app/(app)/), [`apps/web/features/channels/components/channel-workspace.tsx`](apps/web/features/channels/components/channel-workspace.tsx) |
| Shared workspace state aur access | [`apps/web/features/workspace-foundation/`](apps/web/features/workspace-foundation/), [`apps/web/features/identity/components/workspace-access.tsx`](apps/web/features/identity/components/workspace-access.tsx) |
| Channel conversation aur About | [`apps/web/features/channels/components/`](apps/web/features/channels/components/) |
| Direct messages | [`apps/web/features/direct-messages/components/`](apps/web/features/direct-messages/components/) |
| Messages ka shared behavior | [`apps/web/features/conversation-history/`](apps/web/features/conversation-history/) |
| Search | [`apps/web/features/message-search/`](apps/web/features/message-search/) |
| Notifications | [`apps/web/features/notifications/`](apps/web/features/notifications/) |
| Identity aur profiles | [`apps/web/features/identity/components/`](apps/web/features/identity/components/) |
| Theme aur responsive styles | [`apps/web/app/globals.css`](apps/web/app/globals.css), [`packages/ui/src/primitives/`](packages/ui/src/primitives/) |
| CSP aur app configuration | [`apps/web/proxy.ts`](apps/web/proxy.ts), [`apps/web/config/`](apps/web/config/), [`apps/web/constants/application.ts`](apps/web/constants/application.ts) |
