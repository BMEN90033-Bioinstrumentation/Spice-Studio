*
*Zetex ZXMN10A08E6 Spice Model v2.0 Last Revised 21/2/05
*
.SUBCKT ZXMN10A08E6 30 40 50
*------connections-------D-G-S
M1 6 2 5 5 Nmod L=1E-6 W=0.6
M2 5 2 5 6 Pmod L=1.5E-6 W=0.45
RG 4 2 3.2
RIN 2 5 1E12
RD 3 6 Rdmod 0.14
RL 6 5 10E9
C1 2 5 30E-12
C2 3 4 10E-12
D1 5 3  Dbodymod
LD 3 30 0.3E-9
LG 4 40 1.9E-9
LS 5 50 1.9E-9
.MODEL Nmod NMOS (LEVEL=3 TOX=5E-8 NSUB=2E17 VTO=4.05
+KP=18E-5 RS=.07 NFS=2E12 KAPPA=0.06 UO=650 IS=1E-15 N=10)
.MODEL Pmod PMOS (LEVEL=3 TOX=15E-8 NSUB=2E15
+TPG=-1 IS=1E-15 N=10)
.MODEL Dbodymod D (IS=2E-12 RS=.02 IKF=0.06 TRS1=1.5e-3
+CJO=120e-12 BV=101)
.MODEL Rdmod RES (TC1=9.5e-3 TC2=2.5E-5)
.ENDS ZXMN10A08E6
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
