*
*Zetex FZT705 Spice Model v1.0 Last Revised 9/8/90
*
.SUBCKT FZT705 1 2 3
*              C B E
Q1 1 2 4 SUB704
Q2 1 4 3 SUB704 4
*
.MODEL SUB704 PNP IS =3.35584E-14 BF =85 VAF=212 NF =1.002 IKF=.817
+ISE=3.6E-13 NE =4.1 BR =24 VAR=6 NR =.999 IKR=.114 ISC=1.406E-13 NC =1.13
+RB =1.1 RE =.4 RC =.0339 CJE=100E-12 CJC=37E-12 VJC=1.045 MJC=.595
.ENDS FZT705
*
*$
*
*                (c)  2005 Zetex Semiconductors plc
*
*   The copyright in these models  and  the designs embodied belong
*   to Zetex Semiconductors plc (" Zetex ").  They  are  supplied
*   free of charge by Zetex for the purpose of research and design
*   and may be used or copied intact  (including this notice)  for
*   that purpose only.  All other rights are reserved. The models
*   are believed accurate but  no condition  or warranty  as to their
*   merchantability or fitness for purpose is given and no liability
*   in respect of any use is accepted by Zetex PLC, its distributors
*   or agents.
*
*   Zetex Semiconductors plc, Zetex Technology Park, Chadderton,
*   Oldham, United Kingdom, OL9 9LL
