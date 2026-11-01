*
*Zetex ZVN4306G Spice Model v1.1 Last Revised 3/5/00
*
.SUBCKT ZVN4306G 3 4 5
*NODES: DRAIN GATE SOURCE
M1 3 2 5 5 MOD1
RG 4 2 108
RL 3 5 6E6
C1 2 5 224.5E-12
C2 3 2 10.5E-12 
D1 5 3 DIODE1
*
.MODEL MOD1 NMOS VTO=2.634 RS=0.2762 RD=0.0 IS=1E-15 KP=9.77
+CBD=405E-12 PB=1 LAMBDA=0
.MODEL DIODE1 D IS=6.19E-13 N=1.0043 RS=0.065
.ENDS ZVN4306G
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
