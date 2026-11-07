/** Short rules, collapsed by default. */
export function Rules() {
  return (
    <details className="text-sm text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer font-semibold">Reguli</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Texas Hold&apos;em No-Limit, format turneu: toți pornesc cu același buy-in în jetoane. Câștigă ultimul rămas cu jetoane.</li>
        <li>Host-ul face cărțile la prima mână (dealer, D). Butonul de dealer merge apoi în sensul acelor de ceasornic.</li>
        <li>Primii doi după dealer pun small blind (SB) și big blind (BB). În doi, dealer-ul pune small blind.</li>
        <li>Fiecare primește 2 cărți. Urmează 4 runde de licitație: înainte de flop, după flop (3 cărți pe masă), turn (a 4-a) și river (a 5-a).</li>
        <li>La rândul tău: fold (renunți), check (dacă nu ai ce plăti), call (plătești cât s-a pus), raise (mărești, cel puțin cu ultima mărire) sau all-in.</li>
        <li>La final, cea mai bună combinație de 5 cărți din cele 7 (2 ale tale + 5 de pe masă) ia potul. Cine e all-in poate câștiga doar cât a pus (side pots).</li>
        <li>Blind-urile cresc după regula aleasă de host: la un număr de mâini, la un interval de timp, sau de fiecare dată când host-ul face din nou cărțile (după el, următorul intrat la masă care mai are jetoane).</li>
        <li>Observatorii văd masa și jetoanele, dar nu cărțile nimănui până la showdown.</li>
      </ol>
      <p className="mt-2">
        Ordinea mâinilor, de la cea mai mare: chintă roială, chintă de culoare, careu, full house, culoare, chintă, trei de un fel,
        două perechi, pereche, carte mare.
      </p>
    </details>
  );
}
