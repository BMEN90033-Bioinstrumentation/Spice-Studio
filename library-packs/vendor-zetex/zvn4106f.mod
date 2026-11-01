*
*Zetex ZVN4106F Spice Model v1.1 Last Revised 3/5/00
*
.SUBCKT ZVN4106F 3 4 5
* Nodes          D G S
M1 3 2 5 5 MOD1
RG 4 2 343
RL 3 5 6E6
C1 2 5 23.5P
C2 3 2 4.5P 
D1 5 3 DIODE1
*
.MODEL MOD1 NMOS VTO=2.474 RS=1.68 RD=0.0 IS=1E-15 KP=0.296
+CBD=53.5P PB=1 LAMBDA=267E-6
.MODEL DIODE1 D IS=1.254E-13 N=1.0207 RS=0.222
.ENDS ZVN4106F
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
