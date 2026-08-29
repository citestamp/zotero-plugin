# CiteStamp — Zotero UI labels (item-pane section + context menu).
# Filename is plugin-unique so Zotero's auto-registration won't collide.

citestamp-itemmenu-check =
    .label = Check citation health (CiteStamp)

citestamp-itempane-header = CiteStamp
    .label = CiteStamp

# Sidenav (the narrow vertical icon rail): NO value text — a value renders as a
# label inside the button and truncates ("CiteS…") and crowds the icon. Only the
# .label / .tooltiptext attributes (for aria + hover) are wanted; the rail shows
# just the icon.
citestamp-itempane-sidenav =
    .label = CiteStamp
    .tooltiptext = CiteStamp citation health
