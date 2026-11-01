*
*Zetex ZXMN10A11K Spice Model v1.0 Last Revised 08/02/07
*
*
.SUBCKT ZXMN10A11K 30 40 50
*------connections-------D-G-S
M1 6 2 5 5 Nmod L=1E-6 W=0.48
M2 5 2 5 6 Pmod L=1.5E-6 W=0.31
RG 4 2 2.9
RIN 2 5 1E12
RD 3 6 Rdmod 0.28
RL 6 5 10E9
C1 2 5 21E-12
C2 3 4 6.9E-12
D1 5 3  Dbodymod
LD 3 30 1E-9
LG 4 40 2.3E-9
LS 5 50 2.3E-9
.MODEL Nmod NMOS (LEVEL=3 TOX=5E-8 NSUB=2E17 VTO=3.22
+KP=1.42E-5 RS=.023 NFS=2E12 KAPPA=0.06 UO=650 IS=1E-15 N=10)
.MODEL Pmod PMOS (LEVEL=3 TOX=15E-8 NSUB=2E15  TPG=-1 
+IS=1E-15 N=10)
.MODEL Dbodymod D (IS=1.6E-12 RS=0.03 IKF=0.047 TRS1=1.5e-3
+CJO=83e-12  BV=101)
.MODEL Rdmod RES (TC1=7e-3 TC2=2.5E-5)
.ENDS ZXMN10A11K
*
*$
*
*                (c)  2007 Zetex Semiconductors plc
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
