*
*Zetex ZXMN10A07F Spice Model v2.0 Last Revised 21/02/2005
*
.SUBCKT ZXMN10A07F 30 40 50
*------connections-------D-G-S
M1 6 2 5 5 Nmod L=1E-6 W=0.2
M2 5 2 5 6 Pmod L=1.5E-6 W=0.15
RG 4 2 7
RIN 4 5 1E9
RD 3 6 Rdmod 0.58
RB 3 7 Rdmod 0.015
RL 6 5 10E9
C1 2 5 10E-12
C2 3 4 3E-12
D1 5 7  Dbodymod
LD 3 30 0.5E-9
LG 4 40 1.0E-9
LS 5 50 1.0E-9
.MODEL Nmod NMOS (LEVEL=3 TOX=5E-8  NSUB=2E17 VTO=3.7
+KP=8.6E-6 RS=.046 NFS=2E12 KAPPA=0.06 UO=650 IS=6E-15 N=10)
.MODEL Pmod PMOS (LEVEL=3 TOX=15E-8 NSUB=6E15
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=1E-12 N=1.05 RS=0.045 TRS1=1.5e-3 CJO=39e-12 BV=101)
.MODEL Rdmod RES (TC1=7e-3 TC2=1.7E-5)
.ENDS ZXMN10A07F
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
