#!/usr/bin/env bash
# fetch-papers.sh — external references for the M-Clone DP/4 project
#
#   chmod +x fetch-papers.sh && ./fetch-papers.sh
#
# v2 — reconciled against ~/Documents/M-Clone/papers as of 2026-08-07.
# Already in that folder and therefore NOT fetched: ESP2.pdf (the patent),
# DP4_manual.pdf, DigitalTimesI.pdf, and the Dattorro Effect Design trilogy.
#
# Everything below is author-hosted, open-proceedings, public-domain, or
# institutional-repository. Nothing paywalled is fetched; paywalled items are
# listed at the end with official links.
#
# Run it from inside M-Clone/papers to drop straight into the collection:
#   cd ~/Documents/M-Clone/papers && /path/to/fetch-papers.sh

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/dsp-papers"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

OK=0; FAIL=0; SKIP=0
declare -a FAILED=()

get() {  # get <subdir> <filename> <url>
  local dir="$ROOT/$1" out="$ROOT/$1/$2" url="$3"
  mkdir -p "$dir"
  if [[ -s "$out" ]]; then
    printf '  ·  skip (have it)  %s\n' "$2"; ((SKIP++)); return
  fi
  printf '  →  %s\n' "$2"
  if curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 300 \
          -A "$UA" -e "$(dirname "$url")/" -o "$out.part" "$url"; then
    if [[ "$(head -c 5 "$out.part")" == "%PDF-" ]]; then
      mv "$out.part" "$out"
      printf '     ok  %s\n' "$(du -h "$out" | cut -f1)"; ((OK++))
    else
      rm -f "$out.part"
      printf '     !! not a PDF (blocked or moved) — open in a browser:\n     %s\n' "$url"
      FAILED+=("$1/$2  <-  $url"); ((FAIL++))
    fi
  else
    rm -f "$out.part"
    printf '     !! download failed — open in a browser:\n     %s\n' "$url"
    FAILED+=("$1/$2  <-  $url"); ((FAIL++))
  fi
}

echo
echo "==> 0. The DP/4 manual gap  (9 algorithms missing from your copy)"
echo "       German edition — same plates, may carry the pages yours lacks."

get 00-manual-gap "DP4_manual_Deutschland.pdf" \
  "https://ccrma.stanford.edu/~dattorro/dp4_Deutschland.pdf"
get 00-manual-gap "DP4_manual_CCRMA.pdf" \
  "https://ccrma.stanford.edu/~dattorro/DP4_manual.pdf"

echo
echo "==> 1. Dynamics — cmp, ess, gat, key, exp x2  (6 algorithms, 4 of them"
echo "       in your manual's missing run)"

get 01-dynamics "Giannoulis-Massberg-Reiss-DRC-Tutorial-JAES2012.pdf" \
  "https://www.eecs.qmul.ac.uk/~josh/documents/2012/GiannoulisMassbergReiss-dynamicrangecompression-JAES2012.pdf"
get 01-dynamics "Giannoulis-Parameter-Automation-in-a-DRC-JAES2013.pdf" \
  "https://www.eecs.qmul.ac.uk/~josh/documents/2013/Giannoulis%20Massberg%20Reiss%20-%20dynamic%20range%20compression%20automation%20-%20JAES%202013.pdf"
get 01-dynamics "Kroning-Analog-Guitar-Compressor-DAFx11.pdf" \
  "http://recherche.ircam.fr/pub/dafx11/Papers/22_e.pdf"

echo
echo "==> 2. Tube & nonlinear — amp x6, dst x2  (8 algorithms)"

get 02-tube-nonlinear "Yeh-Musical-Distortion-Circuits-thesis.pdf" \
  "https://ccrma.stanford.edu/~dtyeh/papers/DavidYehThesissinglesided.pdf"
get 02-tube-nonlinear "Yeh-Tutorial-on-Wave-Digital-Filters.pdf" \
  "https://ccrma.stanford.edu/~dtyeh/papers/wdftutorial.pdf"
get 02-tube-nonlinear "Yeh-Simulation-of-Guitar-Distortion-Circuits-DAFx08.pdf" \
  "https://ccrma.stanford.edu/~dtyeh/papers/yeh08_dafx_sim.pdf"
get 02-tube-nonlinear "Parker-Zavalishin-LeBivic-ADAA-DAFx16.pdf" \
  "https://www.dafx.de/paper-archive/2016/dafxpapers/20-DAFx-16_paper_41-PN.pdf"

# You have this as saved HTML only — this is the paper PDF. dst character.
get 02-tube-nonlinear "Rossum-Making-Digital-Filters-Sound-Analog-ICMC1992.pdf" \
  "https://quod.lib.umich.edu/cgi/p/pod/dod-idx/making-digital-filters-sound-analog.pdf?c=icmc;idno=bbp2372.1992.009"

echo
echo "==> 3. Phasing, flanging, fractional delay — pha, fla x2, ddl x5"

# You have this as saved HTML only — this is the CCRMA tech report PDF.
get 03-modulation "Smith-STAN-M-21-Allpass-Phasing-Flanging.pdf" \
  "https://ccrma.stanford.edu/files/papers/stanm21.pdf"
get 03-modulation "Laakso-Splitting-the-Unit-Delay.pdf" \
  "http://legacy.spa.aalto.fi/sig-legacy/spit/publications/1996j5.pdf"

echo
echo "==> 4. Reverb — rev x11.  Fills the FDN lineage your folder infers"

get 04-reverb "Gardner-The-Virtual-Acoustic-Room-thesis.pdf" \
  "https://www.ee.columbia.edu/~dpwe/papers/Gardner92-virtroom.pdf"

echo
echo "==> 5. Rotating speaker — rot"

get 05-leslie "Smith-Serafin-Abel-Berners-Doppler-and-the-Leslie-DAFx02.pdf" \
  "https://www.dafx.de/paper-archive/2002/DAFX02_Smith_Serafin_Abel_Berners_doppler_leslie.pdf"
get 05-leslie "Pekonen-Hammond-Organ-Synthesis-DAFx11.pdf" \
  "https://www.dafx.de/paper-archive/2011/Papers/49_e.pdf"

echo
echo "==> 6. Speaker cabinet — spk x3"

get 06-cabinet "Yeh-Bank-Karjalainen-Guitar-Loudspeaker-Cabinet-DAFx08.pdf" \
  "https://dafx.de/paper-archive/2008/papers/dafx08_17.pdf"
get 06-cabinet "Gardner-Efficient-Convolution-Without-IO-Delay.pdf" \
  "https://people.montefiore.uliege.be/josmalskyj/files/Gardner1995Efficient.pdf"
get 06-cabinet "Garcia-Optimal-Filter-Partition-AES2002.pdf" \
  "https://www.angelofarina.it/Public/AES-113/Garcia-PrePrint5660.pdf"

echo
echo "==> 7. Vocoder — voc"

get 07-vocoder "Dudley-The-Carrier-Nature-of-Speech-BSTJ-1940.pdf" \
  "https://archive.org/download/bstj19-4-495/bstj19-4-495.pdf"
get 07-vocoder "Dolson-The-Phase-Vocoder-A-Tutorial-CMJ1986.pdf" \
  "https://www.eumus.edu.uy/eme/ensenanza/electivas/dsp/presentaciones/PhaseVocoderTutorial.pdf"
get 07-vocoder "Gold-Vocoder-Research-at-Lincoln-Lab.pdf" \
  "https://archive.ll.mit.edu/publications/journal/pdf/vol03_no2/3.2.1.vocoder.pdf"

echo
echo "==> 8. Pitch detection — tun (GuitarTuner2U)"

get 08-pitch "McLeod-Wyvill-A-Smarter-Way-to-Find-Pitch-ICMC2005.pdf" \
  "https://www.cs.otago.ac.nz/graphics/Geoff/tartini/papers/A_Smarter_Way_to_Find_Pitch.pdf"
get 08-pitch "deCheveigne-Kawahara-YIN-JASA2002.pdf" \
  "http://audition.ens.fr/adc/pdf/2002_JASA_YIN.pdf"

echo
echo "==> 9. Van der Pol — flt (VandrPolFilter)"

get 09-vanderpol "Weingartner-Stable-Limit-Cycles-as-Tunable-Signal-Sources-DAFx25.pdf" \
  "https://www.dafx.de/paper-archive/2025/DAFx25_paper_68.pdf"
get 09-vanderpol "Ginoux-Letellier-Van-der-Pol-Relaxation-Oscillations.pdf" \
  "https://arxiv.org/pdf/1408.4890"

echo
echo "==> 10. More Dattorro, from his own CCRMA page"
echo "        DigitalTimesII is the sequel to the DigitalTimesI you have."

get 10-dattorro-more "Dattorro-DigitalTimesII-multirate-FIR-decimator.pdf" \
  "https://ccrma.stanford.edu/~dattorro/DigitalTimesII.pdf"
get 10-dattorro-more "Patent-US5027306-Dattorro-decimation-filter.pdf" \
  "https://ccrma.stanford.edu/~dattorro/US5027306.pdf"
get 10-dattorro-more "AD1879-sigma-delta-ADC.pdf" \
  "https://ccrma.stanford.edu/~dattorro/AD1879.pdf"
get 10-dattorro-more "BobAdams-AD1879-app-note.pdf" \
  "https://ccrma.stanford.edu/~dattorro/BobAdamsAD1879.pdf"

# ---------------------------------------------------------------------------
echo
echo "==========================================================="
printf 'downloaded %d   already had %d   failed %d\n' "$OK" "$SKIP" "$FAIL"
if ((FAIL)); then
  echo
  echo "Open these by hand (usually bot-blocking, not a dead link):"
  printf '  %s\n' "${FAILED[@]}"
fi
cat <<'PAYWALL'

===========================================================
NOT FETCHED — paywalled, no legitimate free copy
===========================================================

Rossum, "An Analysis of Pitch-Shifting Algorithms"
    AES 87th, 1989, preprint 2843.  $33   -> closes pit x4
    https://www.aes.org/e-lib/browse.cfm?elib=5851
    NB: AES hyphenates it, "Pitch-Shifting".

Jot & Chaigne, "Digital Delay Networks for Designing
    Artificial Reverberators".  AES 90th, 1991, preprint 3030.  $33
    https://aes2.org/publications/elibrary-page/?id=5663
    Free stand-in: Jot ICMC 1997, http://articles.ircam.fr/textes/Jot97b/

Griesinger, "Practical Processors and Programs for Digital
    Reverberation".  AES 7th Int. Conf., 1989, paper 7-027.  $33
    https://aes2.org/publications/elibrary-page/?id=5469
    His other papers ARE free at http://www.davidgriesinger.com/

Regalia & Mitra, "Tunable Digital Frequency Response
    Equalization Filters".  IEEE Trans. ASSP 35(1), 1987.   -> equ
    https://doi.org/10.1109/TASSP.1987.1165037

Gardner, "Reverberation Algorithms" (Kahrs & Brandenburg ch.3)
    https://link.springer.com/chapter/10.1007/0-306-47042-X_3
    His MS thesis (fetched above) covers much of the same ground.

Pakarinen & Yeh, "A Review of Digital Techniques for Modeling
    Vacuum-Tube Guitar Amplifiers".  CMJ 33(2), 2009.
    https://doi.org/10.1162/comj.2009.33.2.85
    Yeh's thesis ch.1-2 (fetched above) is the same survey.

van der Pol, "On relaxation-oscillations", Phil. Mag. 1926.
    https://doi.org/10.1080/14786442608564127

Three AES preprints at $33 each; membership costs less than three.
PAYWALL
echo
