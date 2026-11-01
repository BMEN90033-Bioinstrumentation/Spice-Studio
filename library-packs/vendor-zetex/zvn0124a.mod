*
*Zetex ZVN0124A Spice Model v1.1 Last Revised 3/5/00
*
.SUBCKT ZVN0124A 3 4 5
*                D G S
M1 3 2 5 5 MN0124
RG 4 2 225
RL 3 5 2.4E7
C1 2 5 60E-12
C2 3 2 2E-12 
D1 5 3 DN0124
*
.MODEL MN0124 NMOS VTO=1.5512 RS=1.436 RD=9.254 IS=1E-15 KP=1.077
+CBD=36E-12 PB=1 LAMBDA=0
.MODEL DN0124 D IS=3.071E-12 N=1.026 RS=0.511
.ENDS ZVN0124A
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
