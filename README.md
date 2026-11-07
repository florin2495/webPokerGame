# webPokerGame

Texas Hold'em No-Limit între prieteni, pe telefon: până la **16 jucători** și **16 observatori** pe cameră (32 de persoane).
Pe stilul [Bingo](https://games.hailatat.icu/classicbingo): Next.js 16 (App Router), Supabase (Postgres + Realtime Broadcast),
deploy pe Vercel (fra1). Adresă: **https://games.hailatat.icu/poker**

## Reguli

1. Format **turneu** (freezeout): toți pornesc cu același **buy-in** în jetoane. Cine rămâne fără jetoane iese, cu locul lui.
   Câștigă ultimul rămas cu jetoane.
2. Host-ul creează camera și alege regulile (le poate schimba în lobby până la start):
   - **buy-in** (jetoanele de start), **small blind** și **big blind** de la care se pleacă;
   - **când cresc blind-urile**:
     - la un număr fix de mâini (ex. la fiecare 10 mâini);
     - **după fiecare tură completă a dealer-ului**: host-ul face cărțile la prima mână, iar blind-urile cresc de fiecare
       dată când host-ul face din nou cărțile. Cu 10 jucători, asta înseamnă la 10 mâini; cu 3 rămași, la 3 mâini.
       Dacă host-ul iese din turneu, rolul trece la următorul intrat la masă după el care mai are jetoane, și tot așa;
     - la un interval de timp (prima mână împărțită după X minute pe același nivel);
   - **creșterea pe nivel**: +25%, +50% sau +100%, rotunjit la valori „de cazino” (10/20 → 15/30 → 25/50 → 30/60 …);
   - **timpul pe tură**: între 10 și 60 de secunde. Cine depășește dă automat **fold**.
3. Ceilalți intră cu codul camerei sau cu linkul `/room/COD` și aleg: **la masă** (max 16) sau **observator** (max 16).
   În lobby oricine se poate muta între masă și observatori. După start, cine intră e doar observator.
4. Ordinea la masă: host-ul primul, apoi în ordinea intrării. Host-ul face cărțile la prima mână; butonul de dealer
   merge apoi la următorul jucător rămas. Primii doi după dealer pun SB și BB; în doi, dealer-ul pune SB și vorbește primul pre-flop.
5. Licitație No-Limit: fold, check, call, bet/raise (cel puțin cu ultima mărire, sau all-in). Un all-in mai mic decât
   o mărire completă nu redeschide licitația pentru cine a vorbit deja. Side pots corecte, jetonul nedivizibil merge primului
   câștigător din stânga dealer-ului, surplusul nechemat se întoarce.
6. Showdown: toate mâinile rămase se arată; cea mai bună combinație de 5 din 7 câștigă. Observatorii nu văd cărțile nimănui
   până la showdown.
7. După fiecare mână, rezultatul stă 8 s pe ecran, apoi se împarte automat următoarea (host-ul poate da „Împarte acum”).
8. La final, clasamentul; host-ul poate porni un **turneu nou** în aceeași cameră.

### Opțiuni automate (fiecare jucător, în timpul turneului)
- **Auto check**: dacă nu răspunzi în 5 s de la începutul turei, se dă check; dacă înainte a fost un raise, se dă fold.
- **Auto big blind**: dacă nu răspunzi în 5 s, suntem înainte de flop și nimeni n-a mărit (miza e încă big blind-ul),
  se plătește big blind-ul (sau check, dacă îl ai deja pus). Dacă ambele sunt bifate, înainte de flop fără mărire are
  prioritate auto big blind.
- Opțiunile se țin minte pe dispozitiv și se aplică automat la fiecare turneu nou.

### Extra
- Host-ul poate **sări tura** unui jucător blocat (check dacă se poate, altfel fold) și poate scoate pe cineva.
- Cine pleacă (sau e scos) în timpul turneului dă fold și pierde jetoanele rămase; jetoanele deja puse în pot rămân acolo.
  Dacă pleacă host-ul, devine host următorul jucător.
- Camere: lobby/terminate se închid după 10 minute în care nimeni nu le are deschise; un turneu pe care nu-l mai are
  nimeni deschis se închide după 60 de minute.
- Setări pe dispozitiv: confirmare la all-in și la fold inutil, vibrație când e rândul tău.

## Arhitectură

- Toată logica rulează în Route Handlers (`src/app/api/rooms/...`) cu **service role key**. Regulile pure (evaluare mâini,
  licitație, side pots, nivele de blind) sunt în `src/lib/poker.ts` și sunt testate (`src/lib/poker.test.ts`, inclusiv
  turnee random complete cu 2–16 jucători și conservarea jetoanelor).
- Starea turneului (pachetul și cărțile fiecăruia) e un jsonb în `poker_rooms.game`, scris cu lock optimist pe `version`
  (cu reîncercare automată la conflict). `/state` trimite fiecăruia doar cărțile lui; restul apar doar la showdown.
- Pachetul se amestecă cu RNG criptografic (`node:crypto`).
- Fără cron (Vercel Hobby): expirarea timpului de gândire și mâna următoare sunt declanșate de clienți (întâi host-ul,
  apoi ceilalți ca rezervă), iar serverul verifică termenele. Un request întârziat nu poate sări doi jucători (`turnKey`).
- Tabelele au RLS activat fără policy și `revoke` pentru `anon`/`authenticated`.
- Live: Supabase Realtime Broadcast pe `poker:room:<uuid>` (semnal fără date) + polling la 15 s.

## Setup

1. **Supabase** (proiectul comun al jocurilor): SQL Editor → rulează tot `supabase/schema.sql`.
   Creează doar `poker_rooms` și `poker_players`.
2. **Local**: `npm install`, `cp .env.example .env.local` (aceleași 3 valori ca la celelalte jocuri), `npm run dev`, `npm test`.
3. **Vercel**: Import `florin2495/webPokerGame` → Environment Variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` → Deploy (sau Redeploy după ce le adaugi).
   `vercel.json` fixează funcțiile în `fra1` (Frankfurt, lângă DB). Verificare: headerul `X-Vercel-Id` al unui
   request la `/api/rooms` trebuie să conțină `fra1`.
4. **Domeniu**: nu are domeniu propriu; hub-ul (games.hailatat.icu) face proxy pe `/poker/*` către `<proiect>.vercel.app/poker/*` (basePath `/poker`).
