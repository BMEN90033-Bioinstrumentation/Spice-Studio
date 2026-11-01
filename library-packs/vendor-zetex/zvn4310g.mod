*
*Zetex ZVN4310G Spice Model v1.1 Last Revised 8/2/02
*
.SUBCKT ZVN4310G 3 4 5
*NODES: DRAIN GATE SOURCE
M1 3 2 5 5 MOD1
RG 4 2 82
RL 3 5 1E7
C1 2 5 200E-12
C2 3 2 13.5E-12 
D1 5 3 DIODE1
*
.MODEL MOD1 NMOS VTO=2.555 RS=0.2068 RD=0.1665 IS=1E-15 KP=5.02
+CBD=288E-12 PB=1 LAMBDA=0
.MODEL DIODE1 D IS=9.759E-13 N=1.02476 RS=0.0844
.ENDS ZVN4310G
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
