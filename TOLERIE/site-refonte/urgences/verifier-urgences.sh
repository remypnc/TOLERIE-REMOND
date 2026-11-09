#!/bin/sh
# Vérifie de l'extérieur les corrections du GUIDE-URGENCES (lecture seule, aucune modification du site).
# Usage : sh verifier-urgences.sh
B=https://www.tolerie-remond.com
UA="Mozilla/5.0"
ok() { printf '  OK    %s\n' "$1"; }
ko() { printf '  À FAIRE  %s\n' "$1"; }
code() { curl -s -o /dev/null -m 15 -A "$UA" -w '%{http_code}' "$B$1"; }

echo "Sécurité"
curl -s -m 15 -A "$UA" "$B/wp-content/uploads/" | grep -qi 'Index of' && ko "listing de /wp-content/uploads/ visible" || ok "listing des dossiers fermé"
curl -s -m 15 -X POST -d '<?xml version="1.0"?><methodCall><methodName>system.listMethods</methodName></methodCall>' "$B/xmlrpc.php" | grep -q 'system.multicall' && ko "XML-RPC actif" || ok "XML-RPC bloqué"
[ "$(code /readme.html)" = "200" ] && ko "readme.html accessible" || ok "readme.html masqué"
H=$(curl -sI -m 15 "$B/")
for h in strict-transport-security x-content-type-options x-frame-options referrer-policy; do
  echo "$H" | grep -qi "^$h" && ok "en-tête $h" || ko "en-tête $h absent"
done
echo "$H" | grep -qi 'x-powered-by: PHP/7' && ko "PHP 7 toujours annoncé" || ok "PHP 7 non annoncé"
curl -s -m 15 -A "$UA" "$B/" | grep -q 'Slider Revolution 6\.2\.' && ko "Slider Revolution 6.2 encore chargé" || ok "Slider Revolution 6.2 absent"

echo "Juridique"
[ "$(code /mentions-legales/)" = "200" ] && ok "page mentions légales" || ko "page mentions légales absente"
[ "$(code /politique-cookies/)" = "200" ] && ok "page politique cookies" || ko "page politique cookies absente"
P=$(curl -s -m 15 -A "$UA" "$B/")
echo "$P" | grep -qiE 'complianz|cmplz|cookieyes|tarteaucitron|axeptio' && ok "outil de consentement présent" || ko "aucun outil de consentement détecté"
echo "$P" | grep -q 'UA-12932700' && ko "ancien tag Universal Analytics présent" || ok "ancien tag UA retiré"
echo "$P" | grep -q 'clarity' && ok "Microsoft Clarity détecté" || ko "Microsoft Clarity absent"

echo "SEO / cohérence"
R=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$B/decoupe-numerique-metal-sur-mesure-dijon-montbard-bourgogne/")
[ "$R" = "301" ] && ok "ancien lien 404 redirigé" || ko "ancien lien renvoie $R"
echo "$P" | grep -q 'decoupe-numerique-metal-sur-mesure' && ko "liens vers l'ancienne page encore sur l'accueil" || ok "liens cassés retirés de l'accueil"
N48=$(echo "$P" | grep -oi '48 \?h' | wc -l | tr -d ' ')
D=$(curl -s -m 15 -A "$UA" "$B/devis-en-ligne/")
echo "$D" | grep -q '24/72' && [ "$N48" -gt 0 ] && ko "délais incohérents (48 h et 24/72 h)" || ok "délai de réponse cohérent"
