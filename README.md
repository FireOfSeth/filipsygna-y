# MEXC Sygnały

Skaner okazji na kontraktach futures (perpetual USDT) giełdy MEXC. Co 15 minut przegląda płynne pary,
a gdy znajdzie okazję – wysyła na Telegram alert z gotową instrukcją: wejście, stop loss, take profit,
dźwignia, ilość kontraktów i kroki do wyklikania na MEXC. Potem śledzi sygnał i pisze, kiedy przesunąć
stop loss, anulować zlecenie albo zamknąć pozycję.

**Aplikacja nie łączy się z Twoim kontem i nie składa zleceń.** Korzysta tylko z publicznych danych rynkowych –
nie potrzebuje kluczy API. Decyzję i kliknięcie zawsze wykonujesz Ty.

> ⚠️ Handel z dźwignią to wysokie ryzyko – możesz stracić cały kapitał. Wyniki historyczne nie gwarantują
> przyszłych. Dopóki `testMode` jest włączony, alerty są oznaczone jako TEST.

---

## 1. Wymagania

- Telegram na telefonie i darmowe konto GitHub (skaner działa na serwerach GitHuba – patrz punkt 4)
- Do uruchomienia u siebie: **Node.js 20+** (`node --version`), Windows/macOS/Linux
- Brak dodatkowych bibliotek – nie trzeba nic instalować przez `npm install`

## 2. Bot na Telegramie (5 minut)

1. W Telegramie wyszukaj **@BotFather** → `/newbot`
2. Podaj nazwę (np. *Moje Sygnały*) i unikalny login kończący się na `bot`
3. BotFather odeśle **token** (wygląda jak `123456789:AAH...`) – nie pokazuj go nikomu
4. Gdzie wpisać token:
   - **GitHub Actions** – jako sekret `TELEGRAM_BOT_TOKEN` (punkt 4). Token nigdy nie trafia do kodu.
   - **własny komputer/serwer** – skopiuj `config.example.json` jako `config.json` i wklej token w `telegram.botToken`
5. Napisz do swojego bota **/start** – czat połączy się sam
   (pierwsza osoba, która napisze do bota, zostaje odbiorcą – zrób to zaraz po uruchomieniu)

### Głośny alarm na iPhonie

- Telegram → czat z botem → dotknij nazwy → **Powiadomienia** → wybierz głośny **dźwięk**
- **Ustawienia iOS → Skupienie (Focus)** → dodaj Telegram do dozwolonych aplikacji, żeby alert przebił tryb „Nie przeszkadzać”
- Przełącznik wyciszenia na boku iPhone'a wycisza Telegram – jeśli ma dzwonić mimo wyciszenia,
  potrzebny jest Pushover z „Critical Alerts” (można dodać w przyszłości)

## 3. Ustawienia (`config.json`)

| Pole | Znaczenie |
|---|---|
| `capitalUsdt` | kapitał startowy (potem zmieniasz komendą `/kapital`) |
| `riskPerTradePct` | ile % kapitału tracisz, gdy zadziała stop loss (komenda `/ryzyko`, max 20) |
| `maxLeverage` | maksymalna dźwignia (36) |
| `testMode` | `true` = alerty oznaczone jako TEST |
| `strategy.name` | `pullback` (korekta w trendzie), `breakout` (wybicie), `meanrev` (powrót do średniej) |
| `strategy.params` | nadpisanie parametrów strategii – domyślne w `src/strategies/*.js` |
| `market.minTurnover24hUsdt` | pomija pary z mniejszym obrotem 24h (domyślnie 3 mln USDT) |
| `market.exclude` | pary do pominięcia, np. `["PEPE_USDT"]` |
| `market.maxAlertsPerScan` | maksymalnie tyle alertów z jednego skanu (najsilniejsze) |

### Jak liczona jest pozycja

1. Strategia wyznacza wejście i stop loss.
2. Wielkość pozycji = kwota ryzyka ÷ odległość do stop lossa – przy SL tracisz założoną kwotę.
3. Dźwignia = najniższa, przy której depozyt mieści się w 90% kapitału, maks. 36x.
4. Dźwignia nigdy nie jest tak wysoka, żeby likwidacja wypadła przed stop lossem (likwidacja min. 2× dalej niż SL).
   Jeśli stop jest za blisko – pozycja jest zmniejszana i alert o tym informuje.

## 4. Uruchomienie 24/7 za darmo (GitHub Actions)

Skaner działa na serwerach GitHuba, więc Twój komputer może być wyłączony. Koszt: 0 zł, bez karty.

1. Załóż darmowe konto na <https://github.com> i potwierdź e-mail.
2. Kliknij **New repository** → nazwa np. `mexc-sygnaly` → zaznacz **Public** → **Create repository**.
   *Publiczne repozytorium ma nielimitowany darmowy czas działania; prywatne ma tylko 2000 minut na miesiąc, czyli za mało.*
3. Wgraj pliki projektu: **Add file → Upload files** → przeciągnij zawartość folderu → **Commit changes**.
4. Dodaj plik z harmonogramem osobno (przeglądarka nie wysyła ukrytych folderów):
   **Add file → Create new file** → w polu nazwy wpisz `.github/workflows/skaner.yml` → wklej treść z tego samego pliku w projekcie → **Commit changes**.
5. **Settings → Secrets and variables → Actions → New repository secret**:
   nazwa `TELEGRAM_BOT_TOKEN`, wartość: token od BotFathera. Token trafia do sejfu GitHuba, nie do kodu.
6. **Settings → Actions → General → Workflow permissions** → zaznacz **Read and write permissions** → **Save**.
   Bez tego skaner nie zapisze historii sygnałów.
7. Zakładka **Actions** → jeśli pojawi się pytanie, kliknij **I understand my workflows, go ahead and enable them**.
8. Wejdź w **Skaner MEXC → Run workflow**, żeby sprawdzić od razu. W logu powinno być `Skan: ... par`.
9. Napisz do swojego bota w Telegramie **/start**. Czat połączy się przy najbliższym przebiegu (do 15 minut), a potem przyjdzie potwierdzenie.

Od tej pory GitHub uruchamia skaner co 15 minut. Historia sygnałów zapisuje się w `data/state.json` w repozytorium,
więc statystyki nie znikają między przebiegami.

### Co trzeba wiedzieć o darmowym hostingu

- **Opóźnienia**: GitHub odpala zadania 5-20 minut po czasie. Dlatego alert pokazuje, ile minut temu powstał sygnał,
  a skaner sam pomija okazje, w których cena zdążyła uciec, dojść do stop lossa albo do TP1.
- **Komendy Telegrama** (`/status`, `/stats`, `/test`) działają, ale odpowiedź przychodzi przy kolejnym przebiegu, do 15 minut.
- **Repozytorium jest publiczne**: historia sygnałów i numer Twojego czatu są widoczne. Token bota pozostaje ukryty w sekrecie.
- **Ustawienia** zmieniasz komendami `/kapital` i `/ryzyko` – zapisują się w `data/state.json`. Plik `config.json` nie trafia na GitHuba.
- Codziennie o 9:00 przychodzi raport dzienny. Jeśli nie przyszedł, coś się zatrzymało – sprawdź zakładkę **Actions**.
- GitHub wyłącza harmonogram w repozytoriach bez aktywności przez 60 dni. Skaner zapisuje stan po każdym sygnale, więc zwykle nie zaśnie.

## 4b. Uruchomienie na własnym komputerze lub serwerze

```bash
npm start
```

Tryb ciągły: skanuje dokładnie co świecę, komendy działają natychmiast. Komputer nie może usnąć.

Na serwerze (Ubuntu) wystarczy jedna komenda – instaluje Node.js, usługę i autostart po restarcie:

```bash
sudo bash deploy/setup.sh
```

Jest też `Dockerfile` i `docker-compose.yml` (`docker compose up -d`).

Test dźwięku bez czekania na sygnał: `npm run test-alert` albo komenda `/test` w Telegramie.

## 5. Komendy w Telegramie

| Komenda | Działanie |
|---|---|
| `/status` | czy skaner działa, ostatni skan, aktywne sygnały |
| `/stats` | skuteczność sygnałów i symulacja kapitału |
| `/kapital 120` | ustaw aktualny kapitał |
| `/ryzyko 5` | ryzyko na transakcję w % |
| `/pauza`, `/wznow` | wstrzymaj / wznów alerty |
| `/test` | przykładowy alert |

## 6. Testy na historii

```bash
npm run backtest -- --days 90
node src/research.js --days 180 --test-days 60
```

- `backtest` – wynik strategii z `config.json` na ostatnich N dniach
- `research` – porównanie wariantów wszystkich strategii: parametry wybierane na starszych danych,
  sprawdzane na najnowszych `test-days` dniach, których wybór „nie widział”

Wynik w **R**: 1R = kwota ryzyka na transakcję. Średnio +0.10 R przy 20 USDT ryzyka to +2 USDT na transakcję.

## 7. Pliki

```
src/index.js          skaner + Telegram (npm start)
src/strategies/       strategie: pullback, breakout, meanrev
src/sizing.js         dźwignia i wielkość pozycji
src/trade.js          śledzenie sygnału (wejście, TP1, TP2, SL, czas)
src/backtest.js       test strategii na historii
src/research.js       porównanie strategii (trening / test)
data/state.json       historia sygnałów, kapitał, ustawienia z komend
```
