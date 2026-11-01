*
*Zetex ZVP3306A Spice Model v1.1 Last Revised 3/5/00
*
.SUBCKT ZVP3306A 3 4 5
*                D G S
M1 3 2 5 5 P3306M
RG 4 2 252
RL 3 5 1.2E8
C1 2 5 28E-12
C2 3 2 3E-12
D1 3 5 P3306D
*
.MODEL P3306M PMOS VTO=-2.875 RS=5.227 RD=7.524 IS=1E-15 KP=.145
+CBD=35E-12 PB=1 LAMBDA=6.67E-3
.MODEL P3306D D IS=5E-12 RS=.768
.ENDS ZVP3306A
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
