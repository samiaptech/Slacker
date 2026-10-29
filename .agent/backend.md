# Backend aur App Flows — Roman Urdu

Yeh guide sign-in se le kar workspace, channels, chat, attachments aur direct messages tak
request ka rasta samjhati hai. Har section mein UI se API, service, repository/storage tak
ka flow diya gaya hai. Code links ke `#L...` hisse current source line numbers hain; code
badalne ke baad unhein dobara verify aur update karna zaroori hai.

## Code ko parhne ka tareeqa

Backend feature aam tor par is chain mein kaam karta hai:

1. **Route** HTTP path ko sahi controller se jorta hai.
2. **Controller** session/headers aur request body validate karta, service call karta, phir
   HTTP status/response banata hai.
3. **Service** feature ke rules aur authorization decision chalati hai.
4. **Repository** feature ke data operations ko storage contract ke zariye naam deti hai.
5. **Mongo storage** actual query, transaction, collection validator aur indexes chalata hai.

Is architecture ka guide [architecture instructions](./instructions/architecture.md) aur
policy [architecture.yaml](../architecture.yaml) mein hai. Har feature mein zaroori nahi ke
har layer alag file mein ho; file links neeche actual implementation dikhate hain.

## 1. API start hona aur request ki bunyaad

- [server.mts](../servers/api/server.mts#L1) environment se config parhta, MongoDB connect
  karta aur integrations/services compose karta hai. Isi file mein workspace, channel,
  DM, attachment, notifications aur realtime dependencies ek doosre ko di jati hain.
- [create-app.ts](../servers/api/bootstrap/create-app.ts#L44) Express app ko configure
  karta: HTTP logging, security headers, CORS aur shared rate limit pehle lagte hain.
  Better Auth handler `/api/auth` par mount hota hai; us ke baad JSON parser aur feature
  routes mount hote hain. Aakhir mein unknown-route aur central error handlers aate hain.
- Workspace endpoints `X-Workspace-Id` header se selected workspace lete hain. Sirf is
  header ka hona access nahi deta: service actual user-workspace membership MongoDB se
  verify karti hai.
- Mongo transactions ka shared wrapper
  [connection.ts](../servers/api/integrations/mongodb/connection.ts) mein hai. Workspace
  creation, membership aur message writes jahan zaroori hon transaction mein commit hote
  hain.

## 2. Google sign-in aur session

1. Sign-in page
   [page.tsx](../apps/web/app/sign-in/page.tsx#L1) `SignIn` component aur API origin deta
   hai. Google button aur redirect flow
   [sign-in.tsx](../apps/web/features/identity/components/sign-in.tsx#L14) mein hai:
   Better Auth ko `provider: "google"` aur login ke baad app ka `/` callback diya jata hai.
2. [auth-client.ts](../apps/web/features/identity/components/auth-client.ts#L6) Better
   Auth client banata hai. `credentials: "include"` ki wajah se browser session cookies
   bhejta aur response par qabool karta hai.
3. API ka auth integration
   [authentication.ts](../servers/api/integrations/authentication/authentication.ts#L31)
   Better Auth ko Mongo adapter aur `/api/auth` base path ke saath setup karta hai.
   [Google provider aur user validation](../servers/api/integrations/authentication/authentication.ts#L41)
   Google OAuth enable karte aur verified Google email ki shart lagate hain; email/password
   login enabled nahi hai. Production mein secure cookies configure hote hain.
4. [getIdentity](../servers/api/integrations/authentication/authentication.ts#L77) incoming
   headers se Better Auth session nikal kar user ka id, naam, email, title aur image deta
   hai. Feature controllers isi identity ko authorization ke liye use karte hain.

## 3. Workspace list, select aur create

- App ka authenticated shell
  [app layout](../apps/web/app/(app)/layout.tsx) mein `WorkspaceAccess` ke andar hota hai.
- [WorkspaceAccess](../apps/web/features/identity/components/workspace-access.tsx#L80)
  localStorage se `nutshyll.activeWorkspaceId` parhta hai; `/workspaces` aur, agar pehle
  se selected workspace ho, `/workspace` access request concurrently bhejta hai.
  Workspace list mein saved selection nahi milay to pehla available workspace chunta hai.
  Server se access dobara verify hone ke baad hi workspace context app ko milta hai.
- Naya workspace banane ka form aur `POST /workspaces` request
  [workspace-access.tsx](../apps/web/features/identity/components/workspace-access.tsx#L199)
  mein hain. Created workspace select aur localStorage mein save hota hai, phir `/workspace`
  se access load karke invite step khulta hai.
- API mapping
  [workspace.route.ts](../servers/api/features/workspaces/routes/workspace.route.ts#L24)
  mein hai. `POST /workspaces`, `GET /workspaces` aur `GET /workspace` alag controllers se
  guzarte hain.
- [Workspace service](../servers/api/features/workspaces/services/workspaces.service.ts#L315)
  naam trim karke whitespace normalize aur 1–80 character limit enforce karti hai. Creator
  ko `admin` membership milti hai; workspace aur pehli membership repository transaction
  mein likhe jate hain. Uske baad
  [ensureGeneralChannel](../servers/api/features/channels/services/channel.service.ts#L261)
  default public `general` channel banata/join karata hai.
- Controller
  [workspace.controller.ts](../servers/api/features/workspaces/controllers/workspace.controller.ts#L314)
  authenticated identity aur body validate karta, service errors ko HTTP errors mein map
  karta aur create par `201` deta hai.
- Backend persistence ki boundary
  [workspace.repository.ts](../servers/api/features/workspaces/repositories/workspace.repository.ts#L62)
  aur Mongo implementation
  [mongo-workspace.storage.ts](../servers/api/features/workspaces/integrations/mongo-workspace.storage.ts#L80)
  mein hai. Storage required validators/indexes bhi verify karta hai; setup missing ho to
  request ko success kehne ke bajaye unavailable error deta hai.

## 4. Workspace invitation link aur accept

1. UI mein link banane ka button
   [workspace-access.tsx](../apps/web/features/identity/components/workspace-access.tsx#L251)
   `POST /workspaces/:workspaceId/invite-links` call karta. Copy feedback link ki 7-day
   expiry batata hai.
2. [Invite service](../servers/api/features/workspaces/services/workspaces.service.ts#L347)
   pehle check karti hai ke caller us workspace ka admin hai. 32-byte random URL-safe token
   banta hai; database mein raw token nahi, SHA-256 hash aur expiry store hoti hai. Raw token
   sirf invite URL mein return hota hai. Expiry 7 din hai.
3. [Invite page](../apps/web/app/invite/[token]/page.tsx#L1) token ko
   [WorkspaceInvitation](../apps/web/features/identity/components/workspace-invitation.tsx#L23)
   deta hai. Component `POST /workspace-invitations/:token/accept` karta hai. Session na ho
   to user ko Google sign-in dikhata hai aur callback isi invite page par wapas laata hai.
4. [Accept service](../servers/api/features/workspaces/services/workspaces.service.ts#L378)
   token format check, hash lookup aur expiry validation ke baad workspace verify karti hai.
   Naya member workspace membership aur `general` channel membership hasil karta hai;
   duplicate membership ko `alreadyMember` ke roop mein safe response milta hai.
5. [Invite controller](../servers/api/features/workspaces/controllers/workspace.controller.ts#L395)
   token acceptance ke baad membership realtime update publish karta hai. UI selected
   workspace ID localStorage mein rakhti hai; `Open workspace` button `/` par le jata hai.

Workspace aur channel memberships alag hain: workspace invite se user workspace member aur
default `general` member banta hai; doosre private channels ke liye alag invitation zaroori
ho sakti hai.

## 5. Channel create aur membership

- Create dialog
  [create-channel-dialog.tsx](../apps/web/features/channels/components/create-channel-dialog.tsx#L29)
  name, optional description, aur public/private visibility leta hai. Submission pehle
  client validation karta, idempotency key tayar karta aur success par nayi channel route par
  navigate karta hai.
- [submitChannelCreation](../apps/web/features/channels/types/submit-channel-creation.ts#L65)
  `POST /channels` par JSON body, cookie credentials, `X-Workspace-Id` aur
  `Idempotency-Key` bhejta; response schema validate karta hai.
- Route
  [channel.route.ts](../servers/api/features/channels/routes/channel.route.ts#L73)
  channel CRUD/member routes aur messages ke routes wire karta.
  [Channel controller](../servers/api/features/channels/controllers/channel.controller.ts#L285)
  workspace identity/access resolve karne ke baad name/description/visibility aur
  idempotency key validate karta.
- [Channel service](../servers/api/features/channels/services/channel.service.ts#L371)
  domain command se lowercase/format/length/visibility rules lagu karti. Duplicate active
  channel name conflict deta hai. Creator ko channel-level admin membership milti hai;
  channel, creator membership, aur agar diya ho to idempotency record atomic write hote hain.
  Wohi key aur wohi input dobara aaye to pehle banaya response replay hota hai; key ko
  mukhtalif input ke saath reuse karne se conflict aata hai.
- `public` channels workspace members ko discover/join karne ke liye list kiye jate hain;
  `private` channels membership ke baghair list mein nahi aate. Join/invite endpoints bhi
  [channel.route.ts](../servers/api/features/channels/routes/channel.route.ts#L131)
  mein hain; private member invite par service workspace membership aur channel-manager
  permission verify karti hai.
- Persisted creation aur membership operations
  [mongo-channel.storage.ts](../servers/api/features/channels/integrations/mongo-channel.storage.ts#L100)
  mein transaction aur unique indexes ke saath hoti hain.

## 6. Channel message history aur send

### History

- Channel screen
  [channel-page.tsx](../apps/web/features/channels/components/channel-page.tsx#L13)
  pehle `GET /channels/:channelId` se details mangti hai; success par
  [ChannelMessages](../apps/web/features/channels/components/channel-messages.tsx#L88)
  conversation aur history dikhata hai.
- UI ka pehla history request 50 messages ka hota hai. Purani history cursor (`before`)
  se page by page load hoti; cursor timestamp aur message ID par based hai, taake same
  timestamp walay messages bhi skip/duplicate na hon.
- `GET /channels/:channelId/messages` route
  [channel.route.ts](../servers/api/features/channels/routes/channel.route.ts#L98)
  se controller tak jata hai. Controller signed-in user, selected workspace, channel
  membership, page size aur cursor verify karta. Read ke baad us channel ki notifications
  read mark hoti hain.
- Service/repository history ko Mongo storage se laate aur sender profile attach karte hain.
  Mongo query membership verify karti, hidden-for-me messages ko exclude aur bounded newest
  page ko chronological order mein return karti hai:
  [channel-message.service.ts](../servers/api/features/channels/services/channel-message.service.ts#L67),
  [channel-message.repository.ts](../servers/api/features/channels/repositories/channel-message.repository.ts#L107),
  [mongo-channel-message.storage.ts](../servers/api/features/channels/integrations/mongo-channel-message.storage.ts#L82).

### Text message bhejna

- [ChannelMessages](../apps/web/features/channels/components/channel-messages.tsx#L334)
  send se pehle pending message screen par add karta hai; user ko request complete hone ka
  intezar nahi karna padta. API response/realtime event aane par pending row actual message
  se replace hoti. Failure par retry state dikhai jati hai.
- Text-only message JSON ke roop mein bheja jata hai. File saath ho to `FormData` mein
  `text` (agar diya ho) aur repeat `files` fields bheje jate hain.
- `POST /channels/:channelId/messages` ke route mein multipart upload se **pehle**
  authorization middleware hai, phir bounded in-memory parser, phir send controller:
  [channel.route.ts](../servers/api/features/channels/routes/channel.route.ts#L108).
  Is order se non-member ko pehle file parse/upload karne nahi diya jata.
- [Send controller](../servers/api/features/channels/controllers/channel-message.controller.ts#L257)
  session, workspace aur channel access dobara check karta; message length, non-empty
  message-or-file condition aur har attachment validate karta. Controller service ko
  workspace, channel aur authenticated sender IDs deta—client se bheje sender ID par bharosa
  nahi hota.
- [Message service](../servers/api/features/channels/services/channel-message.service.ts#L101)
  max files, text length, attachment upload aur message persistence coordinate karti. Agar
  upload ke baad DB write fail ho, uploaded assets cleanup ki koshish hoti hai. Mongo storage
  transaction mein channel membership aur active channel check karke message insert karti:
  [mongo-channel-message.storage.ts](../servers/api/features/channels/integrations/mongo-channel-message.storage.ts#L150).
- Successful send par controller notification recipients ko inform karta, realtime channel
  event publish karta aur `201` response deta.

## 7. Chat attachments aur protected download

- UI [channel composer](../apps/web/features/channels/components/channel-messages.tsx#L425)
  aur [DM composer](../apps/web/features/direct-messages/components/direct-message-page.tsx#L317)
  file count/type/size ki early validation aur selected-file display dete. Backend par ye
  checks phir se hotay hain; client-side validation security boundary nahi.
- Shared validator
  [chat-attachment.validation.ts](../servers/api/integrations/cloudinary/chat-attachment.validation.ts#L59)
  5 files per message aur 10 MiB/file limit rakhta hai, filename sanitize karta aur extension
  ke saath file signature/content verify karta. JPEG, PNG, GIF, WebP, PDF, TXT, CSV aur MD
  qabool hain.
- [Cloudinary integration](../servers/api/integrations/cloudinary/cloudinary.integration.ts#L46)
  asset ko `authenticated` delivery mode mein upload karti; public provider URL client ko
  nahi milta. Mongo message mein safe metadata aur provider asset reference save hota.
- Message response mein API ka authorized `downloadUrl` aata hai. Download request par API
  current workspace/channel membership ya DM participation, message aur attachment ID
  dobara verify karti; uske baad provider se file la kar `nosniff` headers ke saath response
  bhejti.
- Browser attachment fetch mein cookie aur selected-workspace header jata hai. UI origin ko
  verify karke file download karti; image preview bhi authorized API se hi aati hai:
  [channel attachment UI](../apps/web/features/channels/components/channel-messages.tsx#L444)
  aur [DM attachment UI](../apps/web/features/direct-messages/components/direct-message-page.tsx#L336).

## 8. Message delete — “for me” aur “for everyone”

- Message menu `scope: "me"` ya `scope: "everyone"` bhejta. Dono channel aur DM UI mein
  delete request aur failure state hain:
  [channel delete UI](../apps/web/features/channels/components/channel-messages.tsx#L487),
  [DM delete UI](../apps/web/features/direct-messages/components/direct-message-page.tsx#L379).
- Controller scope validate karke authenticated user ID, workspace role aur message ID
  service ko deta. Invalid scope reject hota hai.
- Storage `me` mein message ko sirf us user ke `hiddenForUserIds` mein add karti. `everyone`
  mein message record permanently delete hota. Message author ya workspace admin hi
  everyone-delete kar sakta; channel case mein requester ka channel membership bhi check
  hota hai.
- “For everyone” ke saath attachments hon to service unhein private Cloudinary storage se
  delete karti; cleanup failure explicit `503` deta hai, kyunke message delete ho chuka ho
  sakta hai magar asset cleanup adhoora reh sakta hai. Realtime deletion event dusre active
  clients ko update karta.
- Channel implementation:
  [controller](../servers/api/features/channels/controllers/channel-message.controller.ts#L157),
  [service](../servers/api/features/channels/services/channel-message.service.ts#L205),
  [Mongo storage](../servers/api/features/channels/integrations/mongo-channel-message.storage.ts#L180).
  DM controller/service/storage:
  [controller](../servers/api/features/direct-messages/controllers/direct-message.controller.ts#L333),
  [service](../servers/api/features/direct-messages/services/direct-message.service.ts#L108),
  [Mongo storage](../servers/api/features/direct-messages/integrations/mongo-direct-message.storage.ts#L235).

## 9. Direct messages (DM)

1. UI conversation page
   [direct-message-page.tsx](../apps/web/features/direct-messages/components/direct-message-page.tsx#L62)
   conversation details aur pehli 50 messages parallel load karta hai. Purana history cursor
   se paginated hota hai; user ko prepend ke baad scroll position par rakhne ke liye anchor
   preserve hota hai.
2. Nayi DM kholne ke liye `POST /direct-messages` mein recipient ID aata hai. Controller
   authenticated workspace access aur request schema verify karta:
   [direct-message.route.ts](../servers/api/features/direct-messages/routes/direct-message.route.ts#L68),
   [direct-message.controller.ts](../servers/api/features/direct-messages/controllers/direct-message.controller.ts#L201).
3. [DM service](../servers/api/features/direct-messages/services/direct-message.service.ts#L69)
   self-chat rokta, dono users ki workspace membership verify karta aur participant IDs ko
   stable order mein rakh kar pair key banata. Is unique pair key se ek hi workspace mein
   dono users ki duplicate conversations nahi banti. Sirf workspace members DM kar sakte.
4. `GET /direct-messages`, `/direct-messages/:conversationId` aur
   `/direct-messages/:conversationId/messages` list, details aur paginated history dete.
   Storage queries mein workspace ID aur current user ka participant hona lazmi hai:
   [routes](../servers/api/features/direct-messages/routes/direct-message.route.ts#L74),
   [Mongo storage](../servers/api/features/direct-messages/integrations/mongo-direct-message.storage.ts#L125).
5. DM send channel jaisa optimistic UI aur text/file handling use karta. Route upload se pehle
   conversation participant authorization karta; service participant verify karke message
   save karti aur conversation `lastActivityAt` update karti:
   [DM UI send](../apps/web/features/direct-messages/components/direct-message-page.tsx#L244),
   [send service](../servers/api/features/direct-messages/services/direct-message.service.ts#L195),
   [send route](../servers/api/features/direct-messages/routes/direct-message.route.ts#L79).
6. DM attachments download karte waqt user ka conversation participant hona, message visible
   hona aur attachment ID message se match karna verify hota. “For me” hide aur
   “for everyone” delete bhi isi conversation ke liye wahi author/admin policy follow karte
   hain.

## 10. Realtime aur notifications

### 10.1 API vs Socket/WebSocket — sahi architecture rule

Project ka architecture hybrid hai, lekin rule clear hai:

- `API` = source of truth, validation, authorization, persistence, fetch, pagination aur
  recovery layer.
- `Socket/WebSocket` = live event delivery layer sirf tab jab state already API se save ho
  chuki ho.

Yani message create/edit/delete/reaction/toggle ko socket ke zariye direct mutate nahi karna
chaiye. Har mutation ko pehle API se validate aur persist karna chahiye; phir server us result
ko relevant clients par realtime broadcast karta hai.

Sahi flow:

1. Client request API par jata hai.
2. API user identity, workspace membership, message existence aur permissions check karta hai.
3. Database transaction/operation run hoti hai.
4. API response success deta hai.
5. Server matching realtime event emit karta hai.
6. Clients jo active screen par hain, socket event ke throughupdate receive karte hain.
7. Agar socket disconnect ho jaye to client history API se fresh state fetch karta hai.

Aisi cheezein jo socket ke zariye ho sakti hain:
- typing indicator
- member online/offline presence
- channel/DM live updates
- reaction live counts/message row update
- message delete/edit broadcast
- notification bell live refresh

Aisi cheezein jo API ke bina nahi honi chahiye:
- message creation with validation
- edit with author check + conflict check
- delete with permission check
- upload/attachment authorization
- DM create/accept and membership validation
- search and paginated fetch
- reload recovery after disconnect

Yeh rule project-wide laga hai. Socket ko “one and only backend” nahi mana jata; socket sirf
live fan-out layer hai. Agar app reconnect ho jaye to API hi state ka trusted source banta hai.

### 10.2 Active implementation details

- [ChannelRealtimeProvider](../apps/web/features/channels/components/channel-realtime-provider.tsx#L32)
  cookie credential ke saath WebSocket-only Socket.IO connection banata aur active workspace
  subscribe karta. Channel/DM page apne munasib channel/conversation events subscribe karte.
- [Socket.IO integration](../servers/api/integrations/socket-io/socket-io.ts#L67) handshake
  par session identity verify karta. Connection limits aur inbound-event rate limit bhi hain;
  established session har 30 second baad revalidate hota, session invalid ho to socket
  disconnect hota.
- Realtime message broadcast durable message storage ka badal nahi. Client reconnect par
  history API se messages dobara load karta; realtime active screen ko foran update karta.
- Message send API notification service ko bhi call karta:
  [notification service](../servers/api/features/notifications/service.ts#L65).
  Channel/DM history kholne par us resource ki notifications read mark hoti hain.

Is policy ko message editing planning mein bhi follow karna chahiye: `PATCH` API se edited text
save hoga aur server phir `message:updated` realtime event broadcast karega, socket sirf UI ko
update karne ke liye use hoga. Direct socket-only edit logic kabhi accepted nahi hoga.

## 11. Database initialization

Runtime har feature ki expected validators/indexes check karta. Missing ya mukhtalif schema
ko silently create karke normal request serve nahi karta; pehle documented initializer
chalana hota hai. API README ke [migration notes](../servers/api/README.md#L140) ke mutabiq
channel, DM aur notifications migrations deployment se pehle authorized database par chalayein.
Root `pnpm run initialize` aggregate setup hai. Production par isey app start/build command
na banayein; `.env` values ya credentials is guide mein copy na karein.

## 12. Aindah feature par documentation update

Har future backend feature/change ke saath isi `backend.md` mein uska user flow, HTTP endpoint,
request/response aur authorization rules, relevant UI/API/service/storage file links, aur
verified line references update hon. Agar feature realtime, notification, migration ya test
behavior badle to woh bhi likhein. Purane line numbers copy na karein—change ke baad source
mein unhein dobara check karein. Yeh rule har code feature par lagu hai, sirf DM/chat tak
mehdood nahi.

## 13. Emoji reactions — persistent backend flow

- Shared emoji allowlist aur response contract
  [message-reaction.ts](../packages/types/src/api/chat/message-reaction.ts#L1) mein hain.
  `POST /channels/:channelId/messages/:messageId/reactions` aur
  `POST /direct-messages/:conversationId/messages/:messageId/reactions` ke body mein
  `{ "emoji": "👍" }` bheja jata hai. Unsupported emoji par `400 validation_error` milta hai.
- Channel request ko
  [createToggleChannelMessageReactionController](../servers/api/features/channels/controllers/channel-message.controller.ts#L90)
  aur DM request ko
  [createToggleDirectMessageReactionController](../servers/api/features/direct-messages/controllers/direct-message.controller.ts#L131)
  handle karta hai. Dono authenticated user/workspace ko server se resolve karte hain;
  channel mein active membership, DM mein conversation participation aur message visibility
  storage transaction mein dobara verify hoti hai. Unauthorized ya unavailable message ko
  `404` se chhupaya jata hai.
- Mongo persistence
  [message-reactions/model.ts](../servers/api/features/message-reactions/model.ts#L3)
  mein `message_reactions` collection, validator, unique user/emoji/message identity index
  aur lookup index define karta hai. Ek partial unique index yeh bhi enforce karta hai ke
  har user ki ek message par sirf aik active emoji ho.
  [mongo-operations.ts](../servers/api/features/message-reactions/mongo-operations.ts#L21)
  deterministic ID se reaction atomically toggle karta hai: wahi active emoji aaye to band
  hota hai; doosra emoji aaye to purana inactive aur naya active hota hai. Migration mein
  agar purane data mein multiple active emojis hon to sab se naya `updatedAt` wala rakha
  jata hai. Mongo transaction ke andar database reads serially hoti hain; session
  par parallel operations se `ConflictingOperationInProgress` ho sakta hai. Channel
  history load ke waqt member authorization wali dono reads bhi sequential honi chahiye;
  yahan parallel session reads channel history ko HTTP `500` de sakti hain.
- Channel storage
  [mongo-channel-message.storage.ts](../servers/api/features/channels/integrations/mongo-channel-message.storage.ts#L232)
  aur DM storage
  [mongo-direct-message.storage.ts](../servers/api/features/direct-messages/integrations/mongo-direct-message.storage.ts#L297)
  history ke saath reactions load karte aur toggle authorization enforce karte hain.
  Message send/history responses mein `reactions` hota hai. Har emoji ka exact `count`,
  `reactedByMe`, aur zyada se zyada 10 users (`id`, `name`, `image`) aate hain;
  `usersTruncated` batata hai jab count ke muqable mein user list mukammal nahin.
- Successful toggle sab room participants ko realtime par
  `channel:message:reactions` ya `direct-message:reactions` deta hai. “Delete for everyone”
  message ke saath uski reactions bhi mita deta hai; “Delete for me” sirf current user ki
  history se message chhupata hai.
- Schema `channels:initialize` aur `direct-messages:initialize` dono se initialize/update
  hota hai; root `pnpm run initialize` in dono ko sequentially chalata hai. Production API
  startup migration nahin chalata. Test coverage
  [channel.route.test.ts](../servers/api/features/channels/tests/channel.route.test.ts#L875)
  aur [direct-message.route.test.ts](../servers/api/features/direct-messages/tests/direct-message.route.test.ts#L31)
  mein route response, identity, validation aur participant denial cover karti hai.

## 14. Message editing — channel aur DM

- Frontend dono conversations mein `PATCH /channels/:channelId/messages/:messageId` ya
  `PATCH /direct-messages/:conversationId/messages/:messageId` ko strict JSON
  `{ "text": "...", "expectedEditedAt": null | "<ISO timestamp>" }` bhejta hai.
  `expectedEditedAt` omit kiya ja sakta hai sirf first edit ke liye; backend usay `null`
  samajhta hai.
- Channel route/controller
  [channel.route.ts](../servers/api/features/channels/routes/channel.route.ts#L126) aur
  [createEditChannelMessageController](../servers/api/features/channels/controllers/channel-message.controller.ts#L146)
  se chalte hain; DM equivalents
  [direct-message.route.ts](../servers/api/features/direct-messages/routes/direct-message.route.ts#L95)
  aur [createEditDirectMessageController](../servers/api/features/direct-messages/controllers/direct-message.controller.ts#L189)
  mein hain. Workspace authentication ke baad storage current channel membership ya DM
  participation, message visibility aur author identity verify karta hai. Admin doosray
  member ka message edit nahi kar sakta.
- Service blank text aur 4,000 Unicode code points limit validate karti hai. Attachment-only
  message `400 validation_error` ke saath reject hota hai; normal text-plus-attachment message
  edit karne par files bilkul change nahi hotin.
- [Channel Mongo storage](../servers/api/features/channels/integrations/mongo-channel-message.storage.ts#L193)
  aur [DM Mongo storage](../servers/api/features/direct-messages/integrations/mongo-direct-message.storage.ts#L231)
  transaction mein `expectedEditedAt` ko conditional write filter se compare karte hain.
  Concurrent stale write `409 message_edit_conflict`; non-author `403 message_edit_forbidden`;
  hidden, missing, ya inaccessible target privacy-safe `404` deta hai. Successful update sirf
  `text` aur `editedAt` badalta hai; `createdAt`, attachments, reactions, notifications aur
  conversation ordering preserve rehte hain.
- Success response poora latest message (sender, reactions, authorized attachment URLs,
  `editedAt`) deta hai. Storage commit ke baad
  [channel realtime](../servers/api/features/channels/realtime/channel-realtime.ts#L264)
  `channel:message:updated`, aur
  [DM realtime](../servers/api/features/direct-messages/realtime/direct-message-realtime.ts#L159)
  `direct-message:updated` sirf conversation room mein broadcast karta hai. API canonical
  source rehti hai; reconnect par history/search mein naya persisted text milta hai.
- Deployment par root `pnpm run initialize`, ya dono feature initializers, chalana zaroori
  hai kyunki strict channel/DM message validators ab `editedAt` allow karte hain. API suite
  169 passed / 2 optional Mongo tests skipped, API typecheck/build aur focused ESLint pass;
  live MongoDB migration aur populated-browser flow abhi verify nahi hue.

## 15. Channel @mentions — backend contract

- Composer mention candidates ke liye
  `GET /channels/:channelId/mention-members` call kare. Route
  [channel.route.ts](../servers/api/features/channels/routes/channel.route.ts#L162) ko
  [mention-member controller](../servers/api/features/channels/controllers/channel.controller.ts#L574)
  se jorta hai. Response ka shared shape
  [channel-create-response.ts](../packages/types/src/api/channels/channel-create-response.ts#L58)
  mein hai: sirf current channel members ke stable `id`, `name`, aur `image`; email expose
  nahi hota. Endpoint public aur private channels dono ke liye hai. Workspace access
  authenticate hota hai, channel membership dobara verify hoti hai; missing ya inaccessible
  channel ko privacy-safe `404`, aur response ko `Cache-Control: no-store` milta hai.
- [Channel service](../servers/api/features/channels/services/channel.service.ts#L180)
  authorized membership IDs se bulk identity lookup karti aur safe profiles ko name ke
  mutabiq sort karti. Frontend is list ko ek martaba load karke local filter kare, har
  keystroke par API request na bheje.
- Member choose hone par frontend message text mein `@[user-id]` token bheje aur render mein
  usi ID ka current display name dikhaye. Existing authenticated send controller
  [channel-message.controller.ts](../servers/api/features/channels/controllers/channel-message.controller.ts#L508)
  message persist hone ke baad notification flow call karta; realtime channel broadcast bhi
  isi send flow mein hota hai. Separate mention-send endpoint ya database migration nahi hai.
- [Notification service](../servers/api/features/notifications/service.ts#L60) token IDs
  deduplicate karti aur `notifyChannelMessage` mein pass karti
  ([line 99](../servers/api/features/notifications/service.ts#L99)).
  [Mongo notification storage](../servers/api/features/notifications/mongo-storage.ts#L117)
  sirf current channel memberships ko recipients banata, sender ko suppress karta, aur
  mention ko normal channel-message notification ki jagah ek hi record banata hai. Unknown
  ya doosre channel ke IDs notification nahi paate.

## 16. Per-member channel notification preferences

- Current workspace member apni preference read/update kar sakta hai:
  `GET /channels/:channelId/notification-preference` aur
  `PATCH /channels/:channelId/notification-preference` with
  `{ "preference": "all" | "mentions_only" | "muted" }`. Dono
  [channel routes](../servers/api/features/channels/routes/channel.route.ts#L169) authenticated
  identity aur workspace access ke saath controller mein jate hain; current channel membership
  zaroori hai. Private ya doosre member ki preference read/change nahi ho sakti. Missing ya
  inaccessible channel `404`, invalid input `400`, unauthenticated request `401`, storage
  unavailable `503`; responses `Cache-Control: no-store` hain. Shared response contract
  [channel-create-response.ts](../packages/types/src/api/channels/channel-create-response.ts#L48)
  mein defined hai.
- `all` channel messages, explicit mentions aur channel activity (`member_joined`,
  `member_left`, `channel_updated`) ke notifications leta hai. `mentions_only` sirf explicit
  `@[user-id]` message mentions leta hai; `muted` mentions samet channel notifications rokta
  hai. DM notifications alag hain aur in preferences se mutasir nahi. Legacy membership
  documents mein missing preference `all` samjhi jati hai. Setting badalne par pehle se
  stored notifications delete/reclassify nahi hotin; nayi notification creation par setting
  apply hoti hai.
- Preference `channel_memberships` par optional `notificationPreference` field mein store
  hoti hai. [Mongo channel storage](../servers/api/features/channels/integrations/mongo-channel.storage.ts#L236)
  workspace ke active channel aur current membership verify karti; writes Mongo transaction
  mein hote hain aur membership revision mutate nahi karte. Existing
  [channels initializer](../servers/api/features/channels/models/channel.model.ts#L87)
  strict membership validator update karta; deployment se pehle
  `pnpm --filter @workspace/api channels:initialize` ya root `pnpm run initialize` chalayein.
- [Notification storage](../servers/api/features/notifications/mongo-storage.ts#L127) channel
  message mentions, normal messages aur channel activity ke eligible recipients filter karti.
  `notification.mongo-storage.test.ts` all/mentions-only/muted, activity, actor exclusion,
  deduplication aur DM independence verify karta. Channel route, repository, service aur
  Mongo storage tests preference access, validation, member isolation, legacy default,
  storage errors aur revision stability cover karte hain.