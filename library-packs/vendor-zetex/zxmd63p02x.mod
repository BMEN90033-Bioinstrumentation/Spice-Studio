*
*Zetex ZXMD63P02X Spice Model v1.0 Last Revised 18/8/00
*
.SUBCKT ZXMD63P02X 3 4 5
*               D G S
M1 3 2 5 5 M63P02
RG 4 2 18
RL 3 5 1E9
C1 2 5 700E-12
C2 3 2 55E-12
D1 3 5 D63P02
*
.MODEL M63P02 PMOS VTO=-1.37 RS=0.08 RD=0.04 KP=8
+CBD=700E-12 LAMBDA=9E-3
.MODEL D63P02 D IS=4E-12 N=1.04 IKF=44E-3 RS=96E-3
.ENDS ZXMD63P02X
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
